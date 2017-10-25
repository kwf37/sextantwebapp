const express = require('express');
//const cors = require('cors')
const path = require('path');
const terrainServer = require('./terrainserver');
import {config} from './config/config_loader';

let app = express();

/* // For rendering files to jupyter notebook
app.get('/CustomMaps/:tileset/:z/:x/:y.png', function (req, res) {
    const x = req.params.x;
    let y = req.params.y;
    const z = req.params.z;
    y = 2**z-y-1;
    const tileset = req.params.tileset;
    console.log(path.resolve(__dirname, 'public', 'CustomMaps', tileset, z, x, y + '.png'));
    //res.set('Content-Encoding', 'gzip');
    res.sendFile(path.resolve(__dirname, 'public', 'CustomMaps', tileset, z, x, y + '.png'));
});*/

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