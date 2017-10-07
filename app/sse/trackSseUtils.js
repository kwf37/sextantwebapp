//__BEGIN_LICENSE__
//Copyright (c) 2015, United States Government, as represented by the 
//Administrator of the National Aeronautics and Space Administration. 
//All rights reserved.

//The xGDS platform is licensed under the Apache License, Version 2.0 
//(the "License"); you may not use this file except in compliance with the License. 
//You may obtain a copy of the License at 
//http://www.apache.org/licenses/LICENSE-2.0.

//Unless required by applicable law or agreed to in writing, software distributed 
//under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR 
//CONDITIONS OF ANY KIND, either express or implied. See the License for the 
//specific language governing permissions and limitations under the License.
//__END_LICENSE__

import {config} from './../../config/config_loader';
const hasSSE = ('xgds' in config);

const moment = require('moment');
import {Color, ImageMaterialProperty, ColorMaterialProperty, Cartesian2, Cartesian3, CallbackProperty, HeadingPitchRange, ClockRange,
		Clock, SampledPositionProperty, JulianDate, HermitePolynomialApproximation, TimeIntervalCollection, TimeInterval, ClockViewModel,
		CompositePositionProperty, ConstantPositionProperty, ReferenceFrame} from './../cesium_util/cesium_imports'
import {DynamicLines, buildCylinder, updatePositionHeading, buildRectangle,
	    buildPath } from './../cesium_util/cesiumlib';
import {SSE} from './sseUtils'

const hostname = config.xgds.protocol + '://' + config.xgds.name;
let sse = undefined;
let fakeHeading = true;

if (hasSSE){
	sse = new SSE(hostname);
}

class TrackSSE {

	constructor(viewerWrapper) {
		this.viewerWrapper = viewerWrapper;
		
		// cache of raw data
		this.positions = {};
		this.tracks =  {};
		
		// cesium renderings
		this.cLastPosition = {};
		this.cSampledPositionProperties = {};
		this.cPaths = {};
		
		// colors and materials
		this.colors = {'gray': Color.GRAY.withAlpha(0.75)};
		this.labelColors = {'gray': Color.GRAY};
		this.imageMaterials = {};
		this.colorMaterials = {};
		this.cStopped =  {};
		this.pointerUrl = hostname + '/' + config.server.nginx_prefix + '/icons/pointer.png';
		this.stoppedCylinderStyle = {material: Color.GRAY};

		// various flags
		this.isStopped = [];
		this.STALE_TIMEOUT= 5000;
		this.followPosition = true;
		this.isInitialized=false;
		this.isMoving=false;
		
		// initialize
		this.getCurrentPositions();
		this.allChannels(this.subscribe, this);
		
		let context = this;
		
		// show timeout state
		setInterval(function() {context.allChannels(context.checkStale, context);}, context.STALE_TIMEOUT);
		
		//Event listeners track when camera is moving or not, to prevent zooming during a move
		this.viewerWrapper.viewer.camera.moveStart.addEventListener(function(){context.isMoving=true;});
		this.viewerWrapper.viewer.camera.moveEnd.addEventListener(function(){context.isMoving=false;});

	};

	setFollowPosition(value) {
		this.followPosition = value;
		// tracked entity does follow it but it mucks with the camera angle
		if (value){
			this.viewerWrapper.viewer.trackedEntity = this.cPaths[config.xgds.follow_channel];
		} else {
			this.viewerWrapper.viewer.trackedEntity = undefined;
		}
	};
	
	allChannels(theFunction, context){
		let channels = sse.getChannels();
		if (channels !== undefined){
			for (let i=0; i<channels.length; i++){
				let channel = channels[i];
				if (channel != 'sse') {
					theFunction(channel, context);
				}
			}
		} else {
			alert("Problem connecting to xGDS");
		}
	};

	checkStale(channel, context) {
		let connected = false
		if (context.positions[channel] != undefined){
			let nowmoment =  moment().utc();
			let diff = moment.duration(nowmoment.diff(moment(context.positions[channel].timestamp)));
			if (diff.asSeconds() <= 10) {
				connected = true;
				let index = context.isStopped.indexOf(channel);
				if (index > -1) {
					context.isStopped.splice(index, 1);
				}
			}
		}
		if (!connected){
			context.isStopped.push(channel);
		}
	};

	showDisconnected(channel) {
		this.renderPosition(channel, undefined, true);
	};

	subscribe(channel, context) {
		sse.subscribe('position', context.handlePositionEvent, context, channel);
	};

	handlePositionEvent(event, context){
		let data = JSON.parse(event.data);
		let channel = sse.parseEventChannel(event);
		context.updatePosition(channel, data);
	};
	
	zoomToPositionBadHeight(channel){
		if (channel === undefined){
			channel = config.xgds.follow_channel;
		}
		if (channel !== undefined) {
			let entity = this.cPaths[channel];
			this.viewerWrapper.viewer.zoomTo(entity, new HeadingPitchRange(0, -Math.PI/2.0, 150.0));
		}
	};

	/*
	This Zoom to position method does not change bearing or height. 
	*/
	zoomToPosition(channel){
		if (channel === undefined){
			channel = config.xgds.follow_channel;
		}
		
		if (!this.isMoving) {

			let entity = this.cPaths[channel]; //.ellipse;
            //this was useful: https://groups.google.com/forum/#!topic/cesium-dev/QSFf3RxNRfE
            
	        let ray = this.viewerWrapper.camera.getPickRay(new Cartesian2(
	            Math.round(this.viewerWrapper.viewer.scene.canvas.clientWidth / 2),
	            Math.round(this.viewerWrapper.viewer.scene.canvas.clientHeight / 2)
	        ));
			let position = this.viewerWrapper.viewer.scene.globe.pick(ray, this.viewerWrapper.viewer.scene);
			let range = Cartesian3.distance(position, this.viewerWrapper.camera.position);

			if(this.isInitialized){ //After inital zoom, follows target entity at the viewer's current height
			    this.viewerWrapper.viewer.zoomTo(entity, new HeadingPitchRange(0, -Math.PI/2.0, range));

		    }   

			else{ //Initial zoom to entity

				this.viewerWrapper.viewer.zoomTo(entity, new HeadingPitchRange(0, -Math.PI/2.0, 150.0));
				
				if(range<155.0 && range>145.0){
				    this.isInitialized = true;
			    }

			}
		}
	};
	
	createPosition(channel, data, nonSse){
		// store the data, render the position and get the track
		if (nonSse == undefined){
			nonSse = false;
		}
		this.positions[channel] = data;
		if (fakeHeading) {
			data.heading = (Math.random() * (2* Math.PI)); //TODO testing heading, delete
		}
		this.renderPosition(channel, data, nonSse);
		this.getTrack(channel, data);
	};

	modifyPosition(channel, data, disconnected){
		//console.log(data);
		this.positions[channel] = data;
		if (fakeHeading) {
			data.heading = (Math.random() * (2* Math.PI)); //TODO testing heading, delete
		}
		this.renderPosition(channel, data, disconnected);
	};

	updatePosition(channel, data){
		if (!(channel in this.positions)){
			this.createPosition(channel, data);
		} else {
			this.modifyPosition(channel, data, false);
		}
	};

	toggleTrack(show) {
		if (show){
			this.cPaths[config.xgds.follow_channel].path.trailTime = undefined;
		} else {
			this.cPaths[config.xgds.follow_channel].path.trailTime = 60;
		}
	};
	
	addColor(channel, newColor) {
		let color = Color.fromCssColorString('#' + newColor)
		// make a translucent one
		let cclone = color.clone().withAlpha(0.4);
		this.colors[channel] = cclone;
		this.labelColors[channel] = color;
		return cclone;
	};
	
	renderTrack(channel, data){
		if (! channel in this.colors){
			if (data.color !== undefined) {
				color = this.addColor(data.color);
			}
		}
		
		// update the viewer clock start
		//Set bounds of our simulation time
		if (data.times.length > 0){
			let start = JulianDate.fromIso8601(data.times[0][0]);
			let stop = JulianDate.addHours(start, 12, new JulianDate());

//			this.viewerWrapper.viewer.clock.startTime = start.clone();
//			this.viewerWrapper.viewer.clock.stopTime = stop.clone();
//			this.viewerWrapper.viewer.clock.shouldAnimate = false;  // this makes cylinder show but not animate
			
			var clock = new Clock({
				startTime : start.clone(),
				clockRange: ClockRange.UNBOUNDED
				//stopTime : stop.clone()
				//shouldAnimate: false
			});

			this.viewerWrapper.viewer.clockViewModel = new ClockViewModel(clock);

			let path = this.cPaths[channel];
			if (path !== undefined){
				path.availability =  new TimeIntervalCollection([new TimeInterval({
			        start : start,
			        stop : stop
			    })]);
			}
			
		}
		
		
		this.updateSampledPositionProperty(channel, data);
	};

	convertTrackNameToChannel(track_name){
		let splits = track_name.split('_');
		if (splits.length > 1){
			return splits[1];
		}
		return track_name;
	};
	
	getLatestPosition(channel) {
		if (channel in this.positions) {
			return {'longitude':this.positions[channel].lon, 'latitude':this.positions[channel].lat};
		}
		return undefined;
	};
	
	getMaterial(channel, data) {
		// gets or initializes the material
		let material = undefined;
		let color = Color.GREEN;
		let colorInitialized = false;
		if (channel in this.colors){
			color = this.colors[channel];
			colorInitialized = true;
		}
		
		let hasHeading = (data.heading !== "");
		if (hasHeading) {
			// make sure it has the image material
			if (!(channel in this.imageMaterials)){
				material = new ImageMaterialProperty({'image': this.pointerUrl, 'transparent': true, 'color': color});
				if (colorInitialized) {
					this.imageMaterials[channel] = material;
				}
			} else {
				material = this.imageMaterials[channel];
			}
		} else {
			// make sure it has the color material
			if (!(channel in this.colorMaterials)){
				material = new ColorMaterialProperty({'color': color});
				if (colorInitialized) {
					this.colorMaterials[channel] = material;
				}
			} else {
				material = this.colorMaterials[channel];
			}
		} 
		
		return material;
		
	};
	
	getColor(channel, forLabel) {
		if (forLabel === undefined){
			forLabel = False;
		}
		let sourceMap = this.colors;
		if (forLabel){
			sourceMap = this.labelColors;
		}
		if (channel in this.isStopped) {
			return sourceMap['gray'];
		}
		if (channel in this.colors){
			return sourceMap[channel];
		}
		return Color.GREEN;
	}
	
	getMaterial2(channel) {
		// gets or initializes the material
		let material = undefined;
		let data = this.positions[channel];
		let hasHeading = (data.heading !== "");
		if (hasHeading) {
			// make sure it has the image material
			if (!(channel in this.imageMaterials)){
				this.imageMaterials[channel] = new ImageMaterialProperty({'image': this.pointerUrl, 'transparent': true, 'color': new CallbackProperty(function() {context.getColor(channel);}, false)});
			} 
			material = this.imageMaterials[channel];
		} else {
			// make sure it has the color material
			if (!(channel in this.colorMaterials)){
				this.colorMaterials[channel] = new ColorMaterialProperty({'color': new CallbackProperty(function() {context.getColor(channel);}, false)});
			} 
			material = this.colorMaterials[channel];
		} 
		
		return material;
		
	};
	
	/*
	renderPosition(channel, data, stopped){
		console.log('rendering position');
		if (!(channel in this.cPosition)) {
			let color = Color.GREEN;
			if (channel in this.colors){
				color = this.colors[channel];
			}

			if (!_.isEmpty(data)){
//				let retrievedMaterial = this.getMaterial(channel, data);
				console.log('building position data source');
				let context = this;
				let newMaterial = new CallbackProperty(function() {
					context.getMaterial2(channel);
					}, false);
				buildPositionDataSource({longitude:data.lon, latitude:data.lat}, data.heading,
						channel, newMaterial, channel+'_POSITION', this.getLatestPosition, this, this.viewerWrapper, function(dataSource){
						console.log('built');
						this.cPosition[channel] = dataSource;
				}.bind(this));
			}
		} else {
			let dataSource = this.cPosition[channel];
			let pointEntity = dataSource.entities.values[0];
			
			// update it
			this.viewerWrapper.getRaisedPositions({longitude:data.lon, latitude:data.lat}).then(function(raisedPoint) {
				pointEntity.position.setValue(raisedPoint[0]);
				
			}.bind(this));
		}
	};
	*/
	
	updateSampledPositionProperty(channel, data) {
		let property = undefined;
		if (!(channel in this.cSampledPositionProperties)){
			property = new SampledPositionProperty();
			let context = this;
			property.getValue = function(time, result) {
		        let myresult =  property.getValueInReferenceFrame(time, ReferenceFrame.FIXED, result);
		        if (myresult === undefined){
		        		myresult = context.cLastPosition[channel];
		        }
		        return myresult;
		    };
			this.cSampledPositionProperties[channel] = property;
		} else {
			property = this.cSampledPositionProperties[channel];
		}
		if ('lon' in data) {
			// adding a point
			let cdate = JulianDate.fromIso8601(data.timestamp);
			this.viewerWrapper.getRaisedPositions({longitude:data.lon, latitude:data.lat}).then(function(raisedPoint){
				property.addSample(cdate, raisedPoint[0]);
				this.cLastPosition[channel]=raisedPoint[0];
//				if (this.followPosition){
//					this.zoomToPosition(channel);
//				}

				// compare clock time to this time
				//this.viewerWrapper.viewer.clock.currentTime = cdate.clone();
				//this.viewerWrapper.viewer.clockViewModel.currentTime = cdate.clone();
				//console.log('new data date ' + cdate + ' data.timestamp ' + data.timestamp + ' and data is ' + raisedPoint[0]);
			}.bind(this));
		} else {
			// adding a track 
			if (data.coords.length > 0) {
				// tracks come in blocks of times & coords to handle gaps
				
				for (let i=0; i< data.coords.length; i++){
					let times = data.times[i];
					let lastI = i;
					this.viewerWrapper.getRaisedPositions(data.coords[i]).then(function(raisedPoints){
						let julianTimes = [];
						for (let t=0; t<times.length; t++){
							julianTimes.push(JulianDate.fromIso8601(times[t]));
						};
						console.log('adding samples for ' + lastI + ' time length ' + julianTimes.length + ' point length ' + raisedPoints.length);
						
						if (julianTimes.length != raisedPoints.length) {
							//TODO FIX why is this coming from the server?
							if (julianTimes.length < raisedPoints.length){
								raisedPoints = raisedPoints.slice(0, julianTimes.length);
							} else {
								julianTimes = julianTimes.slice(0, raisedPoints.length);
							}
						}
						property.addSamples(julianTimes, raisedPoints);
					});
					
				}
			}
		}
	}

	renderPosition(channel, data, stopped){
//		console.log('rendering position');
		let color = Color.GREEN; 
		if (channel in this.colors){
			color = this.colors[channel];
		} else {
			color = this.addColor(channel, data.track_hexcolor);
		}

		if (!_.isEmpty(data)){
			if (!(channel in this.cSampledPositionProperties)) {
			
				let retrievedMaterial = this.getMaterial(channel, data);
				let context = this;

//				let sampledPositionProperty = new SampledPositionProperty();
//				sampledPositionProperty.setInterpolationOptions({
//				interpolationDegree : 2,
//				interpolationAlgorithm : HermitePolynomialApproximation
//				});
//				this.updateSampledPositionProperty(sampledPositionProperty, data);
//				this.sampledPositionProperty[channel] = sampledPositionProperty;
//				buildPositionDataSource({longitude:data.lon, latitude:data.lat}, data.heading,
//				channel, retrievedMaterial, channel+'_POSITION', this.getLatestPosition.bind(this), this, sampledPositionProperty,
//				this.viewerWrapper, 
//				function(dataSource){
//				this.cPosition[channel] = dataSource;
//				if (this.followPosition){
//				this.zoomToPosition(channel);
//				}

//				}.bind(this));

				this.updateSampledPositionProperty(channel, data);

				let labelColor = this.getColor(channel, true);
				buildPath(this.cSampledPositionProperties[channel], channel, labelColor, retrievedMaterial, channel+'_POSITION', data.heading, this.viewerWrapper, function(entity){
					let builtPath = entity;
					this.cPaths[channel] = builtPath;
					//TODO add material modifications with callback property
				}.bind(this));

//				buildPositionDataSource({longitude:data.lon, latitude:data.lat}, data.heading,
//				channel, retrievedMaterial, this.getColor(channel, true), channel+'_POSITION', this.getLatestPosition, this, this.viewerWrapper, function(dataSource){
//				this.cPosition[channel] = dataSource;
//				if (this.followPosition){
//				this.zoomToPosition(channel);
//				}
//				}.bind(this));
			} else {
				this.updateSampledPositionProperty(channel, data);

				/*let dataSource = this.cPosition[channel];
			let pointEntity = dataSource.entities.values[0];

			if (stopped){
				let color = this.colors['gray'];
				if (!color.getValue().equals(pointEntity.ellipse.material.color.getValue())){
					pointEntity.ellipse.material.color = color;
				}
				return;
			} */

				// update it
				/*
			this.viewerWrapper.getRaisedPositions({longitude:data.lon, latitude:data.lat}).then(function(raisedPoint) {
				pointEntity.position.setValue(raisedPoint[0]);
				if (this.followPosition){
							this.zoomToPositionKF(channel);
				}

				let retrievedMaterial = this.getMaterial(channel, data);
				let material = pointEntity.ellipse.material;

				let hasHeading = (data.heading !== "");
				if (hasHeading) {
//					console.log('setting orientation ' + data.heading);
					pointEntity.ellipse.stRotation.setValue(data.heading);
					// make sure it has the image material
					if (material.getType() == "Color"){
//						console.log('switching from color to ' + retrievedMaterial.getType());
						pointEntity.ellipse.material = retrievedMaterial;
					} else {
						// it already is, check the color
						if (!retrievedMaterial.color.getValue().equals(pointEntity.ellipse.material.color.getValue())){
							pointEntity.ellipse.material.color = color;
						}
					}
				} else {
					if (material.getType() != "Color"){
//						console.log('switching from ' + material.getType() + ' to ' + retrievedMaterial.getType());
						pointEntity.ellipse.material = retrievedMaterial;
					} else {
						// it already is, check the color
						try {
							if (!color.getValue().equals(pointEntity.ellipse.material.color.getValue())){
								pointEntity.ellipse.material.color = color;
							}
						} catch (err) {
							if (!color.equals(pointEntity.ellipse.material.color.getValue())){
								pointEntity.ellipse.material.color = color;
							}
						}

					}
				} 

			}.bind(this));
				 */
			}
		}
	}; 

	getCurrentPositions() {
		let trackPKUrl = hostname + '/track/position/active/json'
		$.ajax({
			url: trackPKUrl,
			dataType: 'json',
			success: $.proxy(function(data) {
				if (data != null){
					// should return dictionary of channel: position
					for (let track_name in data){
						let channel = this.convertTrackNameToChannel(track_name);
						if (!(channel in this.positions)){
							this.createPosition(channel, data[track_name], true);
						}
					}
				}
			}, this),
			error: $.proxy(function(data) {
				console.log('could not get active track position');
				console.log(data);
			})
		});
	};

	getTrack(channel, data) {
		// first check if we already got it
		if (!_.isEmpty(this.tracks[channel])){
			return;
		}

		let trackUrl =  hostname + '/xgds_map_server/mapJson/basaltApp.BasaltTrack/pk:' + data.track_pk
		$.ajax({
			url: trackUrl,
			dataType: 'json',
			success: $.proxy(function(data) {
				if (data != null && data.length == 1){
					this.tracks[channel] = data[0];
					this.renderTrack(channel, data[0]);
				}
			}, this),
			error: $.proxy(function(response) {
				console.log('could not get track contents for ' + data.track_pk);
				console.log(response);
			})
		});

	};
}

export {TrackSSE}
