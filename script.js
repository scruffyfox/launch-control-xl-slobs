const obsApp = {
	connectionStatus: 'disconnected',
	token: _token,
	url: _url,
	scenes: [],
	audioSources: [],
	sources: [],
	sceneItems: [],
	activeScene: null,
	nextRequestId: 1,
	requests: {},
	subscriptions: {},
	socket: null,

	connect: function() {
		if (this.connectionStatus !== 'disconnected') return
		this.connectionStatus = 'pending'
		this.socket = new SockJS(this.url)

		this.socket.onopen = () => {
			this.request('TcpServerService', 'auth', this.token).then(() => {
				this.onConnectionHandler()
			}).catch(e => {
				alert(e.message)
			})
		}

		this.socket.onmessage = (e) => {
			this.onMessageHandler(e.data)
		}

		this.socket.onclose = (e) => {
			this.connectionStatus = 'disconnected'
		}
	},

	onConnectionHandler: function() {
		this.connectionStatus = 'connected';

		this.request('ScenesService', 'getScenes').then(scenes => {
			scenes.forEach(scene => this.addScene(scene))

			this.request('SourcesService', 'getSources').then(sources => {
				sources.forEach(source => this.addSource(source))
			})
			
			this.request('ScenesService', 'activeSceneId').then(id => {
				const scene = this.scenes.find(scene => scene.id === id)
				scene.isActive = true
				this.activeScene = scene
				this.onSceneSwitchedHandler(scene)
			})
		})
		
		this.subscribe('ScenesService', 'sceneSwitched', activeScene => {
			this.onSceneSwitchedHandler(activeScene)
		})
	},

	request: function(resourceId, methodName, ...args) {
		let id = this.nextRequestId++
		let requestBody = {
			jsonrpc: '2.0',
			id,
			method: methodName,
			params: {
				resource: resourceId,
				args
			}
		}

		return this.sendMessage(requestBody)
	},

	sendMessage: function(message) {
		let requestBody = message
		if (typeof message === 'string') 
		{
			try 
			{
				requestBody = JSON.parse(message)
			}
			catch (e)
			{
				alert('Invalid JSON')
				return
			}
		}

		if (!requestBody.id)
		{
			alert('id is required')
			return
		}

		return new Promise((resolve, reject) => {
			this.requests[requestBody.id] = {
				body: requestBody,
				resolve,
				reject,
				completed: false
			};
			this.socket.send(JSON.stringify(requestBody))
		})
	},

	onMessageHandler: function(data) {
		let message = JSON.parse(data)
		let request = this.requests[message.id]
		
		if (request) 
		{
			if (message.error) 
			{
				request.reject(message.error)
			} 
			else 
			{
				request.resolve(message.result)
			}
			
			delete this.requests[message.id]
		}

		const result = message.result
		if (!result) return

		if (result._type === 'EVENT' && result.emitter === 'STREAM') 
		{
			this.subscriptions[message.result.resourceId](result.data)
		}
	},
	
	addScene: function(scene) {
		this.scenes.push({...scene, isActive: false})
	},
	
	addSource: function(source) {
		this.sources.push(source)
	},

	removeScene: function(sceneId) {
		this.scenes.splice(this.scenes.findIndex(scene => scene.id == sceneId), 1)
	},

	subscribe: function(resourceId, channelName, cb) {
		this.request(resourceId, channelName).then(subscriptionInfo => {
			this.subscriptions[subscriptionInfo.resourceId] = cb;
		})
	},

	onSceneSwitchedHandler: function(activeSceneModel) {
		this.scenes.forEach(scene => {
			scene.isActive = scene.id === activeSceneModel.id
			if (scene.isActive) this.activeScene = scene
		})
		
		// get audio sources
		this.request('AudioService', 'getSourcesForCurrentScene').then(sources => {
			this.audioSources = sources
			this.request(this.activeScene.resourceId, 'getItems').then(items => {
				this.sceneItems = items
				initMacros()
			})
		})
	},
	
	setScene: function(sceneId) {
		return this.request('ScenesService', 'makeSceneActive', sceneId)
	},
	
	setVolume: function(sourceId, percent) {
		this.request("AudioSource[\"" + sourceId + "\"]", 'setDeflection', percent)
	},
	
	setMuted: function(sourceId, isMuted) {
		this.request('SourcesService', 'setMuted', sourceId, isMuted)
	},
	
	setVisible: function(sourceId, isVisible) {
		this.request(sourceId, 'setVisibility', isVisible)
	},
	
	updateTransformation: function(source) {
		return this.request(source.resourceId, 'setTransform', source.transform)
	},
	
	rotateSource: function(source, value) {
		var v = (value / 127) * 360
		this.request(source.resourceId, 'setTransform', { 
			"rotation": v
		})
	},
	
	flipSourceX: function(source, value) {
		if ((value < 54 || value > 74) && this.lastValue !== 1)
		{		
			this.lastValue = 1
			this.request(source.resourceId, 'flipX')
		}
		else if (value == 64)
		{			
			this.lastValue = 0
		}
	},
	
	flipSourceY: function(source, value) {
		if ((value < 54 || value > 74) && this.lastValue !== 1)
		{		
			this.lastValue = 1
			this.request(source.resourceId, 'flipY')
		}
		else if (value == 64)
		{			
			this.lastValue = 0
		}
	},
	
	// finders
	
	findScene: function(name) {
		return this.scenes.find(source => source.name == name)
	},
	
	findNode: function(name) {
		return this.activeScene.nodes.find(node => node.name == name)
	},
	
	findSource: function(name) {
		return this.sources.find(source => source.name == name)
	}
}

const midiApp = {
	midiIn: null,
	midiOut: null,
	macroMap: {},
	
	connect: function() {
		navigator.requestMIDIAccess().then((midi) => {
			midi.addEventListener('statechange', (event) => {
				//initDevices(event.target)
			})
			this.initDevices(midi)
		},
		(err) => console.log('Something went wrong', err))
	},
	
	initDevices: function(midi) {	
		// Reset.
		this.midiIn = null
		this.midiOut = null

		// MIDI devices that send you data.
		console.log("## inputs ##")
		const inputs = midi.inputs.values()
		for (let input = inputs.next(); input && !input.done; input = inputs.next()) {
			console.log(input)
			if (input.value.name.indexOf(device) > -1) {
				this.midiIn = input.value
				break
			}
		}

		// MIDI devices that you send data to.
		console.log("## outputs ##")
		const outputs = midi.outputs.values()
		for (let output = outputs.next(); output && !output.done; output = outputs.next()) {
			console.log(output)
			if (output.value.name.indexOf(device) > -1) {
				this.midiOut = output.value
				break
			}
		}
		
		if (this.midiIn == null || this.midiOut == null) 
		{
			alert("Could not connect to midi device")
			return
		}

		const that = this
		this.midiIn.addEventListener('midimessage', function(event) {
			const cmd = event.data[0]
			const pitch = event.data[1]
			const velocity = (event.data.length > 2) ? event.data[2] : 1
					
			var handled = false
			for (button in that.macroMap)
			{
				if ((that.macroMap[button].note instanceof Array ? that.macroMap[button].note[0] : that.macroMap[button].note) == pitch)
				{
					if (cmd === Commands.CC)
					{
						that.macroMap[button].callback(velocity)
						handled = true
						break
					}
					else
					{
						if (cmd === Commands.NOTE_OFF || (cmd === Commands.NOTE_ON && velocity === 0))
						{
							handled = true
							break
						}
						else if (cmd === Commands.NOTE_ON)
						{
							if (that.macroMap[button].toggle) that.handleToggle(that.macroMap[button])
							that.clearChoke(that.macroMap[button])
							that.macroMap[button].callback()
							handled = true
							break
						}
					}
				}
			}

			if (!handled) 
			{
				if (cmd === Commands.NOTE_OFF || (cmd === Commands.NOTE_ON && velocity === 0))
				{
					that.sendCommand(Commands.NOTE_OFF, pitch, 0)
				}
				else if (cmd === Commands.NOTE_ON)
				{
					that.sendCommand(Commands.NOTE_ON, pitch, Colours.GREEN[0])
				}
			}
		})
		
		this.resetBoard()
		obsApp.connect()
	},
	
	resetBoard: function() { this.sendCommand(176, 0, 0) },
	
	handleToggle: function(button) {
		button.toggled = !button.toggled
		if (button.toggled) this.sendCommand(Commands.NOTE_ON, button.note, button.colour[1])
		else this.sendCommand(Commands.NOTE_ON, button.note, button.colour[0])
	},
	
	initMidiCommands: function() {
		this.resetBoard()
		
		for (button in this.macroMap)
		{
			var b = this.macroMap[button] 
			
			if (b.pot) this.sendCommand(Commands.NOTE_ON, b.note[1] || b.note, b.colour[1])
			else
			{
				if (b.toggled) this.sendCommand(Commands.NOTE_ON, b.note, b.colour[1])
				else this.sendCommand(Commands.NOTE_ON, b.note, b.colour[0])
			}
		}
	},
	
	sendCommand: function(command, note, value, autoOff) {
		this.midiOut.send([command, note, value])
	   
		if (autoOff)
		{
			this.midiOut.send([Commands.NOTE_OFF, note, 0], window.performance.now() + 300)
		}
	},
	
	clearChoke: function(b) {
		for (button in this.macroMap)
		{
			if (this.macroMap[button].choke == b.choke) 
			{
				this.sendCommand(Commands.NOTE_ON, this.macroMap[button].note, this.macroMap[button].colour[0])
			}
		}
		
		this.sendCommand(Commands.NOTE_ON, b.note, b.colour[1])
	}
}

const matrix = [
	[13, [14, 29], [15, 45], [16, 61], [17, 77], [18, 93], [19, 109], [20, 125]], // knob row 1 : note || [note, led note]
	[[29, 14], 30, [31, 46], [32, 62], [33, 78], [34, 94], [35, 110], [36, 126]], // knob row 2 : note || [note, led note]
	[[49, 15], [50, 31], [51, 47], [52, 63], [53, 79], [54, 95], [55, 111], [56, 127]], // knob row 3 : note || [note, led note]
	[77, 78, 79, 80, 81, 82, 83, 84], // faders
	[41, 42, 43, 44, 57, 58, 59, 60], // track focus
	[73, 74, 75, 76, 89, 90, 91, 92], // track control
	[106, 107, 108], // mute/solo/record arm
]

const Colours = {
	OFF: [0x0C, 0x0C],
	RED: [0x0D, 0x0F],
	ORANGE: [0x1D, 0x3F],
	GREEN: [0x1C, 0x3C]
}

const Commands = {
	NOTE_ON: 0x90,
	NOTE_OFF: 0x80,
	CC: 0xb0
}

function initMacros()
{
	midiApp.macroMap = {}
	midiApp.resetBoard()
	
	// audio
	if ((mic = obsApp.audioSources.find(source => source.name == "XLR mic")) != null)
	{
		midiApp.macroMap["mic_toggle_1"] = {
			id: mic,
			note: matrix[6][0],
			toggle: true,
			toggled: mic.muted === true,
			colour: Colours.ORANGE,
			callback: function() {
				obsApp.setMuted(this.id.sourceId, this.toggled)			
			}
		}
		
		midiApp.macroMap["mic_fader_1"] = {
			id: mic,
			note: matrix[3][0],
			fader: true,
			colour: Colours.OFF,
			lastValue: 0,
			callback: function(velocity) {
				var vel = Math.floor((velocity / 127) * 100) / 100
				obsApp.setVolume(this.id.sourceId, vel)
			}
		}
	}
	
	if ((desktop = obsApp.audioSources.find(source => source.name == "Desktop")) != null)
	{
		midiApp.macroMap["desktop"] = {
			id: desktop,
			note: matrix[3][1],
			fader: true,
			colour: Colours.OFF,
			lastValue: 0,
			callback: function(velocity) {
				var vel = Math.floor((velocity / 127) * 100) / 100
				obsApp.setVolume(this.id.sourceId, vel)
			}
		}
	}

	// scene selectors
	var windowCapture = obsApp.findScene("Window Capture")
	midiApp.macroMap["windowCapture"] = {
		id: windowCapture,
		note: matrix[4][0],
		colour: Colours.GREEN,
		toggled: windowCapture.isActive,
		choke: 0,
		callback: function(v) {
			obsApp.setScene(this.id.id)
		}
	}
	
	var brb = obsApp.findScene("BRB")
	midiApp.macroMap["brb"] = {
		id: brb,
		note: matrix[4][5],
		colour: Colours.RED,
		toggled: brb.isActive,
		choke: 0,
		callback: function(v) {
			obsApp.setScene(this.id.id)
		}
	}
	
	var start = obsApp.findScene("START")
	midiApp.macroMap["start"] = {
		id: start,
		note: matrix[4][6],
		colour: Colours.RED,
		toggled: start.isActive,
		choke: 0,
		callback: function(v) {
			obsApp.setScene(this.id.id)
		}
	}
	
	var end = obsApp.findScene("END")
	midiApp.macroMap["end"] = {
		id: end,
		note: matrix[4][7],
		colour: Colours.RED,
		toggled: end.isActive,
		choke: 0,
		callback: function(v) {
			obsApp.setScene(this.id.id)
		}
	}
	
	var soloFullscreen = obsApp.findScene("Solo Fullscreen")
	midiApp.macroMap["soloFullscreen"] = {
		id: soloFullscreen,
		note: matrix[4][1],
		colour: Colours.ORANGE,
		choke: 0,
		toggled: soloFullscreen.isActive,
		callback: function(v) {
			obsApp.setScene(this.id.id)
		}
	}
	
	var fullscreen = obsApp.findScene("Fullscreen")
	midiApp.macroMap[fullscreen] = {
		id: fullscreen,
		note: matrix[4][2],
		colour: Colours.ORANGE,
		choke: 0,
		toggled: fullscreen.isActive,
		callback: function(v) {
			obsApp.setScene(this.id.id)
		}
	}
	
	var zoom1 = obsApp.findScene("Camera Zoom")
	midiApp.macroMap["zoom1"] = {
		id: zoom1,
		note: matrix[4][3],
		colour: Colours.ORANGE,
		choke: 0,
		toggled: zoom1.isActive,
		callback: function(v) {
			obsApp.setScene(this.id.id)
		}
	}
	
	var zoomer = obsApp.findScene("Camera Zoomer")
	midiApp.macroMap["zoomer"] = {
		id: zoomer,
		note: matrix[4][4],
		colour: Colours.ORANGE,
		choke: 0,
		toggled: zoomer.isActive,
		callback: function(v) {
			obsApp.setScene(this.id.id)
		}
	}
	
	// game capture
	if ((gameCapture = obsApp.findNode("Game Capture")) != null)
	{
		midiApp.macroMap["game_capture"] = {
			id: gameCapture,
			note: matrix[5][1],
			colour: Colours.GREEN,
			toggle: true,
			toggled: gameCapture.visible,
			callback: function(velocity) {
				gameCapture.visible = !gameCapture.visible
				obsApp.setVisible(this.id.resourceId, this.toggled)
			}
		}
	}
	
	// camera 
	if ((cam = obsApp.findNode("Elgato Camera")) != null)
	{			
		var camSource = obsApp.findSource(cam.name)
		
		if (obsApp.activeScene.name.indexOf("Fullscreen") > -1)
		{
			midiApp.macroMap["zoom"] = {
				id: cam,
				note: matrix[3][7],
				fader: true,
				colour: Colours.OFF,
				callback: function(velocity) {
					var v = (1 * (1 + ((velocity / 4) / 10)))
					var size = camSource
					var scaled = [size.width * v, size.height * v]
					var diff = [scaled[0] - size.width, scaled[1] - size.height]
					var lastZoom = this.lastZoom || 0
					
					if (Math.abs(lastZoom - v) > 0.01)
					{
						this.id.transform.scale = { 
							"x": v,
							"y": v 
						}
						
						this.id.transform.position = { 
							"x": -(diff[0] / 2), 
							"y": -(diff[1] / 3)
						}
					
						obsApp.updateTransformation(this.id).then(() => this.lastZoom = v)
					}
				}
			}
		}
		else if (obsApp.activeScene.name.indexOf("Capture") > -1)
		{
			midiApp.macroMap["zoom2"] = {
				id: cam,
				note: matrix[3][6],
				fader: true,
				colour: Colours.OFF,
				callback: function(velocity) {
					var v = Math.max((velocity / 127), 0.2)
					var lastZoom = this.lastZoom || 0
					
					if (Math.abs(lastZoom - v) > 0.01)
					{
						this.id.transform.scale = { 
							"x": v,
							"y": v 
						}
						
						obsApp.updateTransformation(this.id)
					}
				}
			}
			
			midiApp.macroMap["ableton_cam"] = {
				id: cam,
				note: matrix[5][2],
				toggle: false,
				colour: Colours.ORANGE,
				callback: function(velocity) {
					this.id.transform = {
						"position":{"x":10,"y":460},
						"scale":{"x":0.35,"y":0.35},
						"crop":{"top":0,"bottom":5,"left":200,"right":545},
						"rotation":0
					}
					obsApp.updateTransformation(this.id)
				}
			}
			
			// TODO: Update source properties to the values of the knobs
		}
		
		if (camSource != null)
		{
			var noteRow = -1
			var offset = true
			
			if (obsApp.activeScene.name.indexOf("Capture") > -1) 
			{
				noteRow = 0
				offset = false
			}
			else if (obsApp.activeScene.name.indexOf("Zoomer") > -1) noteRow = 2
			else if (obsApp.activeScene.name.indexOf("Zoom") > -1) noteRow = 1
			
			if (noteRow > -1)
			{
				midiApp.macroMap["cam_x"] = {
					id: cam,
					note: matrix[noteRow][3],
					colour: Colours.GREEN,
					pot: true,
					callback: function(velocity) {
						if (offset) velocity = -velocity * 2
						var fraction = velocity / 127
						var v = camSource.width * fraction
						
						this.id.transform.position.x = v
						
						obsApp.updateTransformation(this.id).then(() => {
							this.id.originalX = v
						})
					}
				}
				
				midiApp.macroMap["cam_y"] = {
					id: cam,
					note: matrix[noteRow][4],
					colour: Colours.GREEN,
					pot: true,
					callback: function(velocity) {
						if (offset) velocity = -velocity * 2
						var fraction = velocity / 127
						var v = camSource.height * fraction
						
						this.id.transform.position.y = v
						obsApp.updateTransformation(this.id).then(() => {
							this.id.originalY = v
						})
					}
				}
				
				midiApp.macroMap["cam_slow_x"] = {
					id: cam,
					note: matrix[noteRow][2],
					colour: Colours.RED,
					pot: true,
					lastValue: 0,
					callback: function(velocity) {
						velocity *= 2
						this.id.transform.position.x += (velocity - this.lastValue)
						this.lastValue = velocity
						
						obsApp.updateTransformation(this.id).then(() => {
							this.id.originalX = this.id.transform.position.x
						})
					}
				}
				
				midiApp.macroMap["cam_slow_y"] = {
					id: cam,
					note: matrix[noteRow][5],
					colour: Colours.RED,
					pot: true,
					lastValue: 0,
					callback: function(velocity) {
						velocity *= 2
						this.id.transform.position.y += (velocity - this.lastValue)
						this.lastValue = velocity
						
						obsApp.updateTransformation(this.id).then(() => {
							this.id.originalY = this.id.transform.position.y
						})
					}
				}
			}
		}
		
		midiApp.macroMap["cam_hide"] = {
			id: cam,
			note: matrix[5][0],
			colour: Colours.RED,
			toggle: true,
			toggled: cam.visible,
			callback: function(velocity) {
				cam.visible = !cam.visible
				obsApp.setVisible(this.id.resourceId, this.toggled)
			}
		}
		
		midiApp.macroMap["flip_x"] = {
			id: cam,
			colour: Colours.ORANGE,
			pot: true,
			note: matrix[0][0],
			callback: function(v) {
				obsApp.flipSourceX(cam, v)
			}
		}
		
		midiApp.macroMap["flip_y"] = {
			id: cam,
			colour: Colours.ORANGE,
			pot: true,
			note: matrix[0][1],
			callback: function(v) {
				obsApp.flipSourceY(cam, v)
			}
		}
		
		midiApp.macroMap["rotate"] = {
			id: cam,
			colour: Colours.ORANGE,
			pot: true,
			note: matrix[0][7],
			callback: function(v) {
				obsApp.rotateSource(cam, v)
			}
		}
		
		midiApp.macroMap["crop_t"] = {
			id: cam,
			colour: Colours.RED,
			pot: true,
			note: matrix[1][6],
			callback: function(v) {
				var fraction = v / 127
				var height = obsApp.findSource(cam.name).height
				this.id.transform.crop.top = fraction * height
				
				var y = this.id.originalY
				if (y == null)
				{
					this.id.originalY = this.id.transform.position.y
					y = this.id.originalY
				}
				
				//this.id.transform.position.y = y + (this.id.transform.crop.top * this.id.transform.scale.y)
				
				obsApp.updateTransformation(this.id)
			}
		}
		
		midiApp.macroMap["crop_r"] = {
			id: cam,
			colour: Colours.RED,
			pot: true,
			note: matrix[1][7],
			callback: function(v) {
				var fraction = v / 127
				var max = obsApp.findSource(cam.name).width
				this.id.transform.crop.right = fraction * max
				
				obsApp.updateTransformation(this.id)
			}
		}
		
		midiApp.macroMap["crop_l"] = {
			id: cam,
			colour: Colours.RED,
			pot: true,
			note: matrix[2][6],
			callback: function(v) {
				var fraction = v / 127
				var width = obsApp.findSource(cam.name).width				
				this.id.transform.crop.left = fraction * width

				var x = this.id.originalX
				if (x == null)
				{
					this.id.originalX = this.id.transform.position.x
					x = this.id.originalX
				}
				
				//this.id.transform.position.x = x + (this.id.transform.crop.left * this.id.transform.scale.x)
				
				obsApp.updateTransformation(this.id)
			}
		}
		
		midiApp.macroMap["crop_b"] = {
			id: cam,
			colour: Colours.RED,
			pot: true,
			note: matrix[2][7],
			callback: function(v) {
				var fraction = v / 127
				var max = obsApp.findSource(cam.name).height
				this.id.transform.crop.bottom = fraction * max
				
				obsApp.updateTransformation(this.id)
			}
		}
		
		midiApp.macroMap["reset"] = {
			id: cam,
			note: matrix[5][7],
			colour: Colours.RED,
			toggle: false,
			callback: function(velocity) {
				this.id.transform = {
					"crop": {
						"top": 0,
						"left": 0,
						"right": 0,
						"bottom": 0
					},
					"position": {
						"x": 0,
						"y": 0
					},
					"scale": {
						"x": 1,
						"y": 1
					}
				}
				obsApp.updateTransformation(this.id)
			}
		}
	}
	
	midiApp.initMidiCommands()
}

midiApp.connect()