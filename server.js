const express = require('express');
const bodyParser = require('body-parser');
var geocoder = require('geocoder');
var pg = require('pg');

// App/Middleware set up.
const app = express();
const port = process.env.PORT || 8080;

app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

app.listen(port, () => {
	console.log("Server running on port " + port);
});

// Load data stores.
var repositories = require('./app/store/repositories');
var developers = require('./app/store/developers');

// Postgres database set up.
const dbConnectionUrl = 'postgres://localhost:5432/';
const client = new pg.Client(dbConnectionUrl);
client.connect();

// CREATE TABLE IF NOT EXIST
// Precondition: This happens before any end points triggered by clients.
// Create table if it doesn't already exist, only happens once.
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
		console.log('Created table developers');
	});


// Routes.
app.get('/', (req, res) => {
	res.send("Hi, im running on port: " + port);
});

app.get('/repositories', (req, res) => {
	res.send(repositories);
});

// Assume query will include: login of current user and a longitude and latitude.
// Use geocoding service to look up city, return records with city key in a database.
// Hit using: http://localhost:8080/developers/david
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
	geocoder.reverseGeocode(latitude, longitude,  (err, data) => {
		var formattedCityAddress = "not_found"; // Default error value.
		if (err) {
			console.error(err);
		}
		const results = data.results;
		if (results.length > 2) {
			formattedCityAddress = results[2]['formatted_address'];
		} else {
			console.error(err);
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
					[req.body.login, req.body.email, city, req.body.message, req.body.name])
				.on('error', (error) => {
					console.log('/locations potential error: ' + error);
					// Duplicate key error (assumed, kinda hacky but works).
					client
						.query('UPDATE developers SET email=($1), city=($2), message=($3), name=($4) WHERE login=($5)',
							[req.body.email, city, req.body.message, req.body.name, req.body.login])
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


