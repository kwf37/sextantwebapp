const express = require('express');
const path = require('path');
const terrainServer = require('./terrainserver');
import {config} from './config/config_loader';

let app = express();


// Serve static files from the public folder
const publicPath = path.resolve(__dirname, 'public');
app.use(express.static(publicPath));

//TODO might want webpack version of cesium just require it
const cesiumPath = path.resolve(__dirname, 'node_modules', 'cesium', 'Build','Cesium');
app.use(express.static(cesiumPath));

const jqueryPath = path.resolve(__dirname, 'node_modules', 'jquery', 'dist');
app.use('/jquery', express.static(jqueryPath));

//require("imports?this=>window!jquery-mobile/dist/jquery.mobile.js");

const jqueryMobilePath = path.resolve(__dirname, 'node_modules', 'jquery-mobile', 'dist');
app.use('/jquery-mobile', express.static(jqueryMobilePath));

const fontAwesomePath = path.resolve(__dirname, 'node_modules', 'font-awesome');
app.use('/font-awesome', express.static(fontAwesomePath));

const port = config.server.port;
app.listen(port, function () {
  console.log('Example app listening on port ' + port);
});