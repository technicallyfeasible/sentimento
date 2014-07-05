require('cloud/app.js');

Parse.Cloud.afterSave(Parse.User, function(request) {
	var user = request.object;
	if (user.get("firstName") && user.get("lastName") && user.get("email"))
		return;

  var authData = user.get("authData");

  // Quit early for users who aren't linked with Facebook
  if (authData === undefined || authData.facebook === undefined) {
		console.error("Not connected to fb");
    return;
  }

	Parse.Cloud.httpRequest({
    method: "GET",
    url: "https://graph.facebook.com/me",
    params: {
      access_token: authData.facebook.access_token,
      fields: "email,first_name,last_name",
    },
	  success: function(httpResponse) {
			var fbData = JSON.parse(httpResponse.text);
			// we got facebook data, so store it with the user
			user.set("email", fbData.email);
			user.set("firstName", fbData.first_name);
			user.set("lastName", fbData.last_name);
			user.save();
	  },
	  error: function(httpResponse) {
	  }
  });
});


Parse.Cloud.define("sync", function (request, response) {
	var user = Parse.User.current();
	if (!user) {
		response.error("Not logged in");
		return;
	}

	Parse.Cloud.useMasterKey();

  // Quit early for users who aren't linked with Facebook
  var authData = user.get("authData");
  if (authData === undefined || authData.facebook === undefined) {
		response.error("Not connected to fb");
    return;
  }

	Parse.Cloud.httpRequest({
    method: "GET",
    url: "https://graph.facebook.com/"+ authData.id +"/posts",
    params: {
      access_token: authData.facebook.access_token,
			fields: "type,message"
    },
	  success: function(httpResponse) {
			var fbData = JSON.parse(httpResponse.text);

			var Sentiment = Parse.Object.extend("Sentiment");
			var query = new Parse.Query(Sentiment);
			for(var i = 0; i < fbData.length; i++) {
				var data = fbData[i];
				if (!data.id || !data.message || !data.type) continue;

				/*query.get("xWMyZ4YEGZ", {
				  success: function(gameScore) {
				    // The object was retrieved successfully.
				  },
				  error: function(object, error) {
				    // The object was not retrieved successfully.
				    // error is a Parse.Error with an error code and description.
				  }
				});*/

				var sentiment = new Sentiment();
				sentiment.set("id", data.id)
				sentiment.set("type", data.type)
				sentiment.set("text", data.message)
				sentiment.save();
			}

			response.success("done");
	  },
	  error: function(httpResponse) {
			response.error(httpResponse.text);
	  }
  });
});


Parse.Cloud.job("sync", function(request, status) {
	// Set up to modify user data
	Parse.Cloud.useMasterKey();

  var counter = 0;
  // Query for all users
  var query = new Parse.Query(Parse.User);
  query.each(function(user) {
      // Update to plan value passed in
      user.set("plan", request.params.plan);
      if (counter % 100 === 0) {
        // Set the  job's progress status
        status.message(counter + " users processed.");
      }
      counter += 1;
      return user.save();
  }).then(function() {
    // Set the job's success status
    status.success("Migration completed successfully.");
  }, function(error) {
    // Set the job's error status
    status.error("Uh oh, something went wrong.");
  });
});
