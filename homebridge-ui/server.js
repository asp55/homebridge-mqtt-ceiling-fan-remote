//const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
//const mqtt = require('mqtt');

import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import mqtt from 'mqtt';
// your class MUST extend the HomebridgePluginUiServer
class UiServer extends HomebridgePluginUiServer {
  constructor () { 
    // super must be called first
    super();

    // Example: create api endpoint request handlers (example only)
    this.onRequest('/sniff', this.handleSniffRequest.bind(this));

    // this.ready() must be called to let the UI know you are ready to accept api calls
    this.ready();
  }

  /**
   * Example only.
   * Handle requests made from the UI to the `/hello` endpoint.
   */
  async handleSniffRequest(payload) {
    console.log('SNIFF REQUEST', payload);
    

    const results = await new Promise((resolve)=>{

      setTimeout(()=>{
        resolve({ result:'timeout' });
      }, 5*60000);

      const connectUrl = `${payload.mqtt.protocol}://${payload.mqtt.host}:${payload.mqtt.port}`;
      const connectionParams = {
        clientId: `HomebridgeSniffClient${Date.now()}`,
        clean: false,
        connectTimeout: 4000,
        reconnectPeriod: 1000,
      };

      if(payload.mqtt.user) {
        connectionParams.username = payload.mqtt.user;
      }
      if(payload.mqtt.password) {
        connectionParams.password = payload.mqtt.password;
      }

      const rfbridgeResultsTopic = `tele/${payload.rfbridge.topic}/RESULT`;

      const mqttClient = mqtt.connect(connectUrl, connectionParams);

      mqttClient.on('connect', () => {
        console.log('MQTT Connected');
        mqttClient.subscribe([rfbridgeResultsTopic], () => {
          console.log(`Subscribed to topic '${rfbridgeResultsTopic}'`);
        });

        //Make sure that code sniffing is on
        mqttClient.publish(`cmnd/${payload.rfbridge.topic}/rfraw`, 'AAA655');
      });

      mqttClient.on('error', (error)=>{
        resolve({ result:'error', data:error });
      });

      mqttClient.on('message', (topic, data) => {
        if(topic===rfbridgeResultsTopic) {
          //Parse rfraw data;
          const rfraw = JSON.parse(data.toString()).RfRaw;
          if(rfraw && rfraw.Data) {
            const message = rfraw.Data;
            console.log('Received Message:', topic, message);

            if(message.substring(2, 4)==='A6' && message.substring(6, 8)===payload.rfbridge.protocol) {

              console.log('Parsing Message:', message);
              const uartPayload = message.substring(8, message.length-2);

              const bytes = uartPayload.match(/../g);
              if(bytes) {
                const binaryString = bytes.map(byte=>{
                  return parseInt(byte, 16).toString(2).padStart(8, '0');
                }).join('');

                const parsedBinary = binaryString.match(/^1(.{40})00(.{10})11(.{10})0.*/);
                if(parsedBinary !== null ) {

                  const room = parsedBinary[1];
                  mqttClient.end();
                  resolve({ result:'success', data:room });
                }
              }
            }
          }
        }
      });
    });

    



    return results;
  }
}

// start the instance of the class
(() => {
  return new UiServer;
})();