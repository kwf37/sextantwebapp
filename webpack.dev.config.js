const merge = require('webpack-merge');
const common = require('./webpack.config.js');

module.exports = merge(common, {
  devtool: 'inline-source-map',
    stats: {
    	errorDetails: true
    },
  devServer: {
    contentBase: './public',
    port: 3000
  }
});