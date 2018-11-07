//Get the Medooze Media Server interface
const MediaServer = require("medooze-media-server");

//Get Semantic SDP objects
const SemanticSDP	= require("semantic-sdp");
const SDPInfo		= SemanticSDP.SDPInfo;
const MediaInfo		= SemanticSDP.MediaInfo;
const CandidateInfo	= SemanticSDP.CandidateInfo;
const DTLSInfo		= SemanticSDP.DTLSInfo;
const ICEInfo		= SemanticSDP.ICEInfo;
const StreamInfo	= SemanticSDP.StreamInfo;
const TrackInfo		= SemanticSDP.TrackInfo;
const Direction		= SemanticSDP.Direction;
const CodecInfo		= SemanticSDP.CodecInfo;


const Capabilities = {
	video : {
		codecs		: ["vp8"],
		rtx		: true,
		rtcpfbs		: [
			{ "id": "goog-remb"},
			{ "id": "transport-cc"},
			{ "id": "ccm", "params": ["fir"]},
			{ "id": "nack"},
			{ "id": "nack", "params": ["pli"]}
			
		],
		extensions	: [
			"urn:3gpp:video-orientation",
			"http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
			"http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
			"urn:ietf:params:rtp-hdrext:toffse",
			"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
			"urn:ietf:params:rtp-hdrext:sdes:mid"
		],
		simulcast	: true
	}
};
module.exports = function(request,protocol,endpoint)
{
	const connection = request.accept(protocol);
			
	connection.on('message', (frame) =>
	{
		//Get cmd
		var msg = JSON.parse(frame.utf8Data);


		//Get cmd
		if (msg.cmd==="OFFER")
		{
			//Process the sdp
			var offer = SDPInfo.process(msg.offer);

			//Create an DTLS ICE transport in that enpoint
			const transport = endpoint.createTransport(offer);
			
			//Enable bandwidth probing
			transport.setBandwidthProbing(true);
			
			transport.on("targetbitrate",(bitrate)=>{
				
				if (!bitrate)
					return;
				const used = connection.transponder.setTargetBitrate(bitrate);
				const stats = connection.transponder.getAvailableLayers();
				console.log("targetbitrate " + bitrate + " Encoding " + connection.transponder.getSelectedtEncoding() +" TL:" + connection.transponder.getSelectedTemporalLayerId() + " used "+used);
			});
			
			//Set RTP remote properties
			transport.setRemoteProperties(offer);
			
			//Enable bandwidth probing
			transport.setBandwidthProbing(true);
			transport.setMaxProbingBitrate(0); //NO limit
			
			//Create local SDP info
			const answer = offer.answer({
				dtls		: transport.getLocalDTLSInfo(),
				ice		: transport.getLocalICEInfo(),
				candidates	: endpoint.getLocalCandidates(),
				capabilities	: Capabilities
			});

			//Set RTP local  properties
			transport.setLocalProperties({
				video : answer.getMedia("video")
			});

			//Get timestamp
			const ts = Date.now();
			
			//Dump contents
			transport.dump("dumps/simulcast-"+ts+".pcap");
			
			//Create recoreder
			//const recorder = MediaServer.createRecorder ("recordings/simulcast"+ts +".mp4");

			//For each stream offered
			for (let offered of offer.getStreams().values())
			{
				//Create the remote stream into the transport
				const incomingStream = transport.createIncomingStream(offered);

				//Create new local stream
				const outgoingStream  = transport.createOutgoingStream({
					audio: false,
					video: true
				});

				//Get local stream info
				const info = outgoingStream.getStreamInfo();

				//Copy incoming data from the remote stream to the local one
				connection.transponder = outgoingStream.attachTo(incomingStream)[0];
				
				outgoingStream.getVideoTracks()[0].on("remb",(bitrate)=>{
					//connection.transponder.getIncomingTrack()
					if (!bitrate)
						return;
					const used = connection.transponder.setTargetBitrate(bitrate);
					const stats = connection.transponder.getAvailableLayers();
					transport.setMaxProbingBitrate(stats.layers[0].bitrate);
					console.log("remb " + bitrate + " Encoding " + connection.transponder.getSelectedtEncoding() +" TL:" + connection.transponder.getSelectedTemporalLayerId() + " used "+used);
				});
				
				//Start at min layer
				connection.transponder.selectEncoding("b");
				
				//Add local stream info it to the answer
				answer.addStream(info);

				//Record it
				//recorder.record(incomingStream);
			}

			//Send response
			connection.sendUTF(JSON.stringify({
					answer : answer.toString().replace("h264","H264")
				}));

			console.log("OFFER");
			console.log(msg.offer);
			console.log("ANSWER");
			console.log(answer.toString().replace("h264","H264"));
			//Close on disconnect
			connection.on("close",() => {
				//Stop transport an recorded
				transport.stop();
				//recorder.stop();
			});
		}
	});

};
