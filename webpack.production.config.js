const merge = require('webpack-merge');
const webpack = require('webpack');
const MinifyPlugin = require("babel-minify-webpack-plugin");
const common = require('./webpack.config.js');

module.exports = merge(common, {
  plugins: [
  new webpack.optimize.UglifyJsPlugin({
    compress: {
        warnings: false
    }
}),
    
     new webpack.DefinePlugin({
       'process.env': {
         'NODE_ENV': JSON.stringify('production')
       }
   })
  ]
});