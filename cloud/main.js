require('cloud/app.js');

var sentimentKey = "c6e29ce29811cd5a56fd547aee2ea4e8d1b4a0ad";

function updateUser(user) {
	var promise = new Parse.Promise();
	if (user.get("firstName") && user.get("lastName") && user.get("email") && user.get("fb_id") && user.get("fb_pic")) {
		promise.resolve();
		return promise;
	}

  var authData = user.get("authData");

  // Quit early for users who are not linked with Facebook
  if (authData === undefined || authData.facebook === undefined) {
		console.error("Not connected to fb");
		promise.reject("Not connected to fb");
    return promise;
  }

	console.error("Fetching new FB data for user " + user.id);

	Parse.Cloud.httpRequest({
    method: "GET",
    url: "https://graph.facebook.com/me",
    params: {
      access_token: authData.facebook.access_token,
      fields: "email,first_name,last_name",
    }
  }).then(function(httpResponse) {
		// fetch picture
		console.error(httpResponse.text);
		var fbData = JSON.parse(httpResponse.text);
		// we got facebook data, so store it with the user
		user.set("fb_id", fbData.id);
		user.set("email", fbData.email);
		user.set("firstName", fbData.first_name);
		user.set("lastName", fbData.last_name);
		user.save();

		var subPromise = new Parse.Promise();
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
			subPromise.resolve();
		}, function(httpResponse) {
			console.error("err: " + httpResponse.headers["Location"]);
			// we got facebook picture, so store it with the user
			user.set("fb_pic", httpResponse.headers["Location"]);
			user.save();
			subPromise.resolve();
		});
		return subPromise;
	}).then(function(){
		// fetch friends
		return Parse.Cloud.httpRequest({
 	    method: "GET",
 	    url: "https://graph.facebook.com/me/friends",
 	    params: {
 	      access_token: authData.facebook.access_token
 	    }
		}).then(function(httpResponse) {
			console.error("got friends");
			console.error(httpResponse.text);
		});
	}).then(function() {
		promise.resolve();
	}, function(error) { 
		console.error(error);
		promise.reject(error);
	});
	return promise;
};

Parse.Cloud.define("updateUser", function (request, response) {
	var user = Parse.User.current();
	if (!user)
		return;
	updateUser(user).then(function(){
		response.success();
	}, function(error){
		response.error(error);
	});
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
			console.error("Sentiments fetched");
			var result = JSON.parse(httpResponse.text);
			promise.resolve(result);
	  },
	  error: function(httpResponse) {
			console.error(httpResponse.text);
			promise.reject(httpResponse.text);
	  }
  });
};


function sync(user) {
	var promise = new Parse.Promise();
	if (!user) {
		promise.reject("No user");
		return promise;
	}

	//Parse.Cloud.useMasterKey();

  // Quit early for users who are not linked with Facebook
  var authData = user.get("authData");
  if (authData === undefined || authData.facebook === undefined) {
		promise.reject("Not connected to fb: " + user.id);
    return promise;
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
						sentiment.set("date", new Date(data.created_time))
						sentiment.set("type", data.type)
						sentiment.set("text", data.message)
						sentiment.setACL(owner_acl);
						sentimentsById[id] = sentiment;
						sentiments.push(sentiment);
					}

					// fetch sentiment values for all texts
					var promise2 = new Parse.Promise();
					getSentiments(promise2, texts);

					promise2.then(function(scores) {
						if (scores) {
							// got our sentiments, store in db
							for(var i = 0; i < scores.results.length; i++) {
								var score = scores.results[i];
								var sentiment = sentimentsById[score.id];
								if (!sentiment) continue;
								sentiment.set("mood", score.score);
							}
						}
						console.error("Saving " + sentiments.length);
						Parse.Object.saveAll(sentiments).then(function() {
							promise.resolve("done");
						}, function(error) {
							console.error(error);
							promise.reject(error);
						});

					}, function(error) {
						promise.reject(error);
					})
				},
				error: function (error) {
					promise.reject(error);
				}
			});
	  },
	  error: function(httpResponse) {
			promise.reject(httpResponse.text);
	  }
  });
	return promise;
};



function aggregate(user) {
	var promise = new Parse.Promise();
	if (!user) {
		promise.reject("No user");
		return promise;
	}

	var Aggregate = Parse.Object.extend("Aggregate");
	var Sentiment = Parse.Object.extend("Sentiment");

	// ACL to restrict write to user, and public read access
	var owner_acl = new Parse.ACL(user);

	// very simple: fetch all sentiments, delete aggregates and create new aggregates
	var query = new Parse.Query(Aggregate).limit(500);
	query.find().then(function(aggs) {

			console.error("found aggregates " + aggs.length);

			var query = new Parse.Query(Sentiment);
			return query.find().then(function(sentiments) {
				console.error("create new aggregates");

				var minDate = new Date();
				var maxDate = new Date();
				maxDate.setHours(maxDate.getHours() + 1);
				for (var i = 0; i < sentiments.length; i++) {
					var sentiment = sentiments[i];
					var date = sentiment.get("date");
					if (!date) continue;
					if (date < minDate) minDate = date;
					if (date > maxDate) maxDate = date;
				}
				console.error(minDate);
				console.error(maxDate);
				var xDate = new Date(maxDate);
				xDate.setDate(xDate.getDate() - 10);
				if (minDate < xDate)
					minDate = xDate;
				console.error(minDate);
		
				// create new entries in hour intervals between min and max date
				var aggregates = [];
				minDate = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate(), minDate.getHours(), 0, 0, 0);
				maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate(), maxDate.getHours(), 0, 0, 0);
				while(minDate <= maxDate) {
					// find existing aggregate
					var aggregate = null;
					for (var j = 0; j < aggs.length; j++) {
						var oldDate = aggs[j].get("date");
						if (oldDate.getTime() != minDate.getTime()) continue;
						aggregate = aggs[j];
					}

					var nextDate = new Date(minDate);
					nextDate.setHours(nextDate.getHours() + 6);
					// get sentiments in range
					var mood = 0, count = 0;
					for (var j = 0; j < sentiments.length; j++) {
						var sentiment = sentiments[j];
						var date = sentiment.get("date");
						if (date.getTime() < minDate.getTime() || date.getTime() >= nextDate.getTime())
							continue
						mood += sentiment.get("mood") || 0;
						count++;
					}
					if (count > 0) {
						mood /= count;
						// add aggregate
						if (aggregate == null) {
							aggregate = new Aggregate();
							aggregate.set("date", new Date(minDate));
							aggregate.set("mood", mood);
							aggregate.setACL(owner_acl);
							aggregates.push(aggregate);
						}
						else if (aggregate.get("mood") != mood) {
							aggregate.set("mood", mood);
							aggregate.setACL(owner_acl);
							aggregates.push(aggregate);
						}
					}
					else if (aggregate != null)
						aggregate.destroy();
					minDate.setHours(minDate.getHours() + 6);
				}
				console.error("Saving aggregates: " + aggregates.length);
				Parse.Object.saveAll(aggregates).then(function() {
					promise.resolve("done");
				}, function(error) {
					console.error(error);
					promise.reject(error);
				});
			});
	}, function(error) {
		promise.reject(error);
	});
	
	return promise;
}

Parse.Cloud.define("sync", function (request, response) {
	var user = Parse.User.current();
	sync(user).then(function(){
		return aggregate(user);
	}).then(function(result) {
		response.success(result);
	}, function(error) {
		response.error(error);
	});
});


