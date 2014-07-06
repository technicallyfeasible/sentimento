require('cloud/app.js');

var sentimentKey = "c6e29ce29811cd5a56fd547aee2ea4e8d1b4a0ad";

function updateUser(user, response) {
	if (user.get("firstName") && user.get("lastName") && user.get("email") && user.get("fb_id") && user.get("fb_pic")) {
		(response && response.success());
		return;
	}

  var authData = user.get("authData");

  // Quit early for users who aren't linked with Facebook
  if (authData === undefined || authData.facebook === undefined) {
		console.error("Not connected to fb");
		(response && response.error("Not connected to fb"));
    return;
  }

	Parse.Cloud.httpRequest({
    method: "GET",
    url: "https://graph.facebook.com/me",
    params: {
      access_token: authData.facebook.access_token,
      fields: "email,first_name,last_name",
    }
  }).then(function(httpResponse) {
		var fbData = JSON.parse(httpResponse.text);
		// we got facebook data, so store it with the user
		user.set("fb_id", fbData.id);
		user.set("email", fbData.email);
		user.set("firstName", fbData.first_name);
		user.set("lastName", fbData.last_name);
		user.save();

		Parse.Cloud.httpRequest({
 	    method: "GET",
 	    url: "https://graph.facebook.com/me/picture",
 	    params: {
 	      access_token: authData.facebook.access_token
 	    }
		}).then(function(httpResponse) {
			console.error(httpResponse.headers["Location"]);
			// we got facebook picture, so store it with the user
			user.set("fb_pic", httpResponse.headers["Location"]);
			user.save();
			(response && response.success());
		}, function(httpResponse) {
			console.error("err: " + httpResponse.headers["Location"]);
			// we got facebook picture, so store it with the user
			user.set("fb_pic", httpResponse.headers["Location"]);
			user.save();
			(response && response.success());
		});
	}, function(error) { 
		console.error(error);
		(response && response.error(error));
	});
};

Parse.Cloud.define("updateUser", function (request, response) {
	var user = Parse.User.current();
	if (!user)
		return;
	updateUser(user, response);
});

Parse.Cloud.afterSave(Parse.User, function(request) {
	var user = request.object;
	updateUser(user);
});

function getSentiments(promise, texts) {
	if (!texts || texts.length == 0) {
		promise.resolve();
		return;
	}

	// build post data
	var data = "";
	for(var i = 0; i < texts.length; i++) {
		var text = texts[i];
		if (data.length > 0) data += "&";
		data += "text" + text.id + "=" + encodeURIComponent(text.text);
	}

	// http://api.repustate.com/v2/c6e29ce29811cd5a56fd547aee2ea4e8d1b4a0ad/bulk-score.json
	Parse.Cloud.httpRequest({
    method: "POST",
    url: "http://api.repustate.com/v2/"+ sentimentKey +"/bulk-score.json",
    body: data,
	  success: function(httpResponse) {
			console.error(httpResponse.text);
			var result = JSON.parse(httpResponse.text);
			promise.resolve(result);
	  },
	  error: function(httpResponse) {
			console.error(httpResponse.text);
			promise.reject(httpResponse.text);
	  }
  });
};


function sync(user, request, response) {
	if (!user) {
		response.error("Not logged in");
		return;
	}

	//Parse.Cloud.useMasterKey();

  // Quit early for users who aren't linked with Facebook
  var authData = user.get("authData");
  if (authData === undefined || authData.facebook === undefined) {
		response.error("Not connected to fb: " + user.id);
    return;
  }

	// get data from 7 days ago
	var date = new Date();
	date.setDate(date.getDate() - 7);
	var since = date.getFullYear() + "-" + ('0' + (date.getMonth()+1)).slice(-2) + "-" + ('0' + date.getDate()).slice(-2);

	// ACL to restrict write to user, and public read access
	var owner_acl = new Parse.ACL(user);

	Parse.Cloud.httpRequest({
    method: "GET",
    url: "https://graph.facebook.com/me/feed",
    params: {
      access_token: authData.facebook.access_token,
			fields: "message,type",
			//since: since
    },
	  success: function(httpResponse) {
			var result = JSON.parse(httpResponse.text);

			console.error("Loading items: " + result.data.length);

			var Sentiment = Parse.Object.extend("Sentiment");

			var i;
			var fb_ids = [];
			var dataById = {};
			for(var i = 0; i < result.data.length; i++) {
				var data = result.data[i];
				if (!data.id || !data.message) continue;
				fb_ids.push(data.id);
				dataById[data.id] = data;
			}

			var query = new Parse.Query(Sentiment);
			query.containedIn("fb_id", fb_ids);
			query.find({ 
				success: function (results) {
 
					console.error("Already have: " + results.length);
					for(var i = 0; i < results.length; i++) {
						delete dataById[results[i].get("fb_id")];
					}

					var sentimentsById = {};
					var sentiments = [];
					var texts = [];
					for(var id in dataById) {
						var data = dataById[id];
						if (!data) continue;

						texts.push({ id: data.id, text: data.message });

						var sentiment = new Sentiment();
						sentiment.set("fb_id", data.id)
						sentiment.set("date", data.created_time)
						sentiment.set("type", data.type)
						sentiment.set("text", data.message)
						sentiment.setACL(owner_acl);
						sentimentsById[id] = sentiment;
						sentiments.push(sentiment);
					}

					// fetch sentiment values for all texts
					var promise = new Parse.Promise();
					getSentiments(promise, texts);

					promise.then(function(scores) {
						if (scores) {
							// got our sentiments, store in db
							for(var i = 0; i < scores.results.length; i++) {
								var score = scores.results[i];
								var sentiment = sentimentsById[score.id];
								if (!sentiment) continue;
								sentiment.set("mood", score.score);
							}
						}
						Parse.Object.saveAll(sentiments);

						response.success("done");
					}, function(error) {
						response.error(error);
					})
				},
				error: function (error) {
					response.error(error);
				}
			});
	  },
	  error: function(httpResponse) {
			response.error(httpResponse.text);
	  }
  });
};

Parse.Cloud.define("sync", function (request, response) {
	sync(Parse.User.current(), request, response);
});


Parse.Cloud.job("sync", function(request, status) {
	// Set up to modify user data
	Parse.Cloud.useMasterKey();

	var query = new Parse.Query(Parse.User);
  query.find().then(function(users) {

		var iterator = function(i) {
			if (i < users.length) {
				var user = users[i];
				var promise = new Parse.Promise();
				var wrap = {"success": promise.resolve, "error": promise.reject };
				promise.then(function() {
					console.log("inner");
					var promise2 = new Parse.Promise();
					var wrap2 = {"success": promise2.resolve, "error": promise2.reject };
					promise2.then(function() {
						iterator(i + 1);
					}, function(error) {
						console.error("Error: " + error);
						status.error(error);
					});
					console.log("Starting sync for user " + user.id);
					sync(user, request, wrap2);
				}, function(error) {
					console.error("Error: " + error);
					status.error(error);
				});
				console.log("Updating user " + user.id);
				updateUser(user, wrap);
			}
			else
				status.success("done");
		};
		iterator(0);

	}, function(error) {
		status.error(error);
	});
});
