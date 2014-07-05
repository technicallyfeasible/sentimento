require('cloud/app.js');

Parse.Cloud.afterSave(Parse.User, function(request) {
	var user = Parse.User.current();
	if (!user.existed())
		console.error("user signed up: " + user.id);
	else
		console.error("user was saved: " + user.id);
});


Parse.Cloud.define("sync", function (request, response) {
	var user = Parse.User.current();
	if (!user)
		console.error("no user logged in");
	else
		console.error(user.id);
	if (request.user)
		console.error(request.user.id);
	response.success("You are " + (user ? user.id : " not logged in."));
});


//soms


//endsoms

/*Parse.Cloud.job("sync", function(request, status) {
	// Set up to modify user data
	Parse.Cloud.useMasterKey();

	Parse.FacebookUtils.init({
		appId: '235971699946352',                        // App ID from the app dashboard
		channelUrl: '', // Channel file for x-domain comms
		status: true,                                 // Check Facebook Login status
		xfbml: true                                  // Look for social plugins on the page
	});

	Parse.FacebookUtils.logIn(null, {
	  success: function(user) {
		if (!user.existed()) {
		  alert("User signed up and logged in through Facebook!");
		} else {
		  alert("User logged in through Facebook!");
		}
	  },
	  error: function(user, error) {
		alert("User cancelled the Facebook login or did not fully authorize.");
	  }
	});

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
*/