const express = require('express');
const bodyParser = require('body-parser');
var geocoder = require('geocoder');
var pg = require('pg');

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

// Routes.
app.get('/', (req, res) => {
	res.send("Hi, im running on port: " + port);
});

app.get('/repositories', (req, res) => {
	res.send(repositories);
});

app.get('/developers/:login', (req, res) => {
	res.send(developers);
})

/*
Assume post request body is of form:
{email: 'validemail@email.com', latitude: -37.123414, login: 'username', longitude: 145.12341, message: 'my message', name: 'my name'}
Gets formatted city address and inserts into database, if error tries update, if further error it propagates up.
*/
app.post('/locations', (req, res) => {
	console.log("\nLocations post request");
	console.log(req.body);
});

