const express = require('express');
const bodyParser = require('body-parser');
var geocoder = require('geocoder');
var pg = require('pg');

const app = express();
const port = process.env.PORT || 8080;

// Use to parse params/body from request.
app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

app.listen(port, () => {
	console.log("Server running on port " + port);
});

// Set up GeoCoder.
var options = {
  provider: 'google',
  httpAdapter: 'https',
  apiKey: 'AIzaSyBZOpO8-lc7tx9GJRdrFMzH9kqF5d-Y1RQ', 
  formatter: null
};

// Postgress db connection.
const dbConnectionUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/';
const client = new pg.Client(dbConnectionUrl);
client.connect();


// CREATE TABLE IF NOT EXIST
// Precondition: This happens before any end points triggered by clients.
// Create table if it doesn't already exist.
function createTableDevelopers() {
	client
		.query(
	    	'CREATE TABLE IF NOT EXISTS developers(' +
	    	'login VARCHAR(500) PRIMARY KEY,' +
	    	'email VARCHAR(500),' +
	    	'city VARCHAR(500) not null,' +
	    	'message VARCHAR(500) not null,' + 
	    	'name VARCHAR(500) not null)'
	    	)
		.on('end', () => { 
			// Safe to assume this will happen before any transactions.
			console.log('Created table developers');
		});
}

createTableDevelopers();

// Load data stores.
var repositories = require('./app/store/repositories');
var developers = require('./app/store/developers');

// Routes.

app.post('/master/reset/developers', (req, res) => {
	var wentWell = true;
	client
		.query('DROP TABLE IF EXISTS developers CASCADE')
		.on('end', () => {
			console.log('Dropped table if existed developers');
			createTableDevelopers();
		})
		.on('error', (error) => {
			console.error(error);
			wentWell = false;
		});
	return res.json({drop: 'developers', created: 'developers', success: wentWell});
});

app.get('/', (req, res) => {
	res.send("Hi, im running on port: " + port);
});

app.get('/repositories', (req, res) => {
	res.send(repositories);
});

/*
Assume query will include: login of current user and a longitude and latitude.
Use geocoding service to look up city, return records with city key in a database.
Hit using: http://localhost:8080/developers/david
*/
app.get('/developers/:login', (req, res) => {
	const login = req.params.login;
	console.log('\nDevelopers get request: ' + login);
	pg.connect(dbConnectionUrl, (err, client, done) => {
		if (err) {
			done();
			console.error(err);
			return res.status(500).json({success: false, data: 'No location entry found for ' + login});
		}
		var results = [];
		client
			.query('SELECT city FROM developers WHERE login=($1)', [login])
			.on('row', (row) => {
				// Should only happen once.
				results.push(row);
				console.log('City found: ' + row.city);
			})
			.on('end', () => {
				if (results[0] !== undefined) {
					console.log(results);
					console.log(results[0])
					var city = results[0]['city'];
					var relevantDevelopers = [];
					client
						.query('SELECT * FROM developers WHERE city=($1) AND NOT login=($2)', [city, login])
						.on('row', (row) => {
							relevantDevelopers.push(row);
						})
						.on('end', () => {
							done();
							console.log(relevantDevelopers);
							return res.json(relevantDevelopers);
						})
				} else {
					// No developers matching.
					return res.json();
				}
								
			});

	})
})

/*
Assume post request body is of form:
{email: 'validemail@email.com', latitude: -37.123414, login: 'username', longitude: 145.12341, message: 'my message', name: 'my name'}
Gets formatted city address and inserts into database, if error tries update, if further error it propagates up.
*/
app.post('/locations', (req, res) => {
	console.log("\nLocations post request");
	console.log(req.body);
	const latitude = req.body.latitude;
	const longitude = req.body.longitude;

	// Theses values are assumed to be there (most people will provide them), but if not provide defaults so app doesn't crash.
	const name = req.body.name !== '' ? req.body.name : 'N/A';
	const message = req.body.message !== '' ? req.body.message : 'Hi!';
	const email = req.body.email !== '' ? req.body.message :  'N/A'; //  Might lead to issues with email intent.

	geocoder.reverseGeocode(latitude, longitude,  (err, data) => {
		var formattedCityAddress = "not_found"; // Default error value.
		if (err) {
			console.error(err);
		}
		const results = data.results;

		// Note: Sometimes the index of the city is address changes (local vs Heroku).
		// Need to match the address_components type.
		// Need to match this: [ 'colloquial_area', 'locality', 'political' ];
		for (var i = 0; i < results.length; i++) {
			const types = results[i]['types'];
			if (types.length == 3 && types[0] === 'colloquial_area' && types[1] === 'locality' && types[2] === 'political') {
				formattedCityAddress = results[i]['formatted_address'];
				break;
			}
		}
		console.log('Lat: ' + latitude + ', Long: ' + longitude + ' reverse geocoded to: ' + formattedCityAddress);
		
		const city = formattedCityAddress;
		pg.connect(dbConnectionUrl, (err, client, done) => {
			if (err) {
				done();
				console.err(err);
				return res.status(500).json({success: false, data: err});
			}
			console.log('City: ' + city);
			// Insert data.
			client
				.query('INSERT INTO developers(login, email, city, message, name) VALUES($1, $2, $3, $4, $5)', 
					[req.body.login, email, city, message, name])
				.on('error', (error) => {
					console.log('/locations potential error: ' + error);
					// Duplicate key error (assumed, kinda hacky but works).
					client
						.query('UPDATE developers SET email=($1), city=($2), message=($3), name=($4) WHERE login=($5)',
							[email, city, message, name, req.body.login])
						.on('end', () => {
							console.log('Update success: ' + req.body.login);
							done();
							return res.status(200).json({success: true});	
						});
					// If another error happens will propagate up to top error.
				})
				.on('end', () => {
					console.log('Insert success: ' + req.body.login);
					done();
					return res.status(200).json({success: true});
				})
		});
	});
});

// Precondition: People/logins in app/store/developers.js not already in database.
app.post('/master/seed/developers', (req, res) => {
	var wentWell = true;
	for (var i = 0; i < developers.length; i++) {
		const developer = developers[i];
		// Note: had to change location from GitHub API (it is inconsistent i.e. sometimes Melbourne Vic, Aus, other just Melbourne etc). Stick with GeoCoding response.
		client
			.query('INSERT INTO developers(login, email, city, message, name) VALUES($1, $2, $3, $4, $5)', 
						[developer['login'], developer['email'], developer['location'], developer['msg'], developer['name']])
			.on('error', (error) => {
				console.error(error);
				wentWell = false;
			})
			.on('end', () => {
				console.log('Added: ' + developer['login']);
			});
	}
	return res.status(200).json({success: wentWell});

});

