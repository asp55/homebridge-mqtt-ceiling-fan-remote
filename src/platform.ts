import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, SCHEMA_VERSION } from './settings.js';
import { CeilingFanRemote } from './platformAccessory.js';
import os from 'os';

import mqtt from 'mqtt';
import DebounceQueue from './debounceQueue.js';

function binaryCommand(remote:string, command: number = -1): string {
  const room: string = `1${remote.padStart(40, '0')}0`;
  const rfrawCommand: string = `0${command.toString(2).padStart(10, '0')}1`;
  const rfrawInverseCommand: string = rfrawCommand.split('').map(i=>Math.abs(parseInt(i)-1)).join('');

  const output: string = `${room}${rfrawCommand}${rfrawInverseCommand}`;

  return output; 
}

function hexCommand(remote:string, command: number = -1):string {
  const bin = binaryCommand(remote, command);
  const nibbles = 8*Math.ceil(bin.length/8);
  const _bin = bin.padEnd(nibbles, '0');

  let output = '';
  for(let i=0; i<nibbles; i+=8) {
    const byte = parseInt(_bin.substring(i, i+8), 2).toString(16).padStart(2, '0');
    output = `${output}${byte}`; 
  }

  return `AAA8${((nibbles/8)+1).toString(16).padStart(2, '0')}00${output}55`.toUpperCase();
}


const commands = {
  Brightness: {
    0: 266,
    12: 10,
    25: 11,
    37: 12,
    50: 13,
    62: 14,
    75: 15,
    87: 72,
    100: 74
  },
  Speed: {
    0: 98,
    1: 2,
    2: 32,
    3: 66
  }
};

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class CeilingFanRemotePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly rooms:CeilingFanRemote[] = [];
  public readonly remotes: {[remote_id:string] : CeilingFanRemote[]} = {};
  public readonly initializedRemotes: string[] = [];

  public readonly remoteCommands = {};

  private mqttClient:mqtt.MqttClient | undefined;
  private rfbridgeResultsTopic:string = '';
  private rfbridgeBootTopic:string = '';

  private debounceQueue:DebounceQueue = new DebounceQueue(500);

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug(Date.now()+' Initializing ceiling fan platform');

    if(!(this.config._version && this.config._version === SCHEMA_VERSION )) {
      this.log.info(`Schema version has been updated.
      You're currently using version ${this.config._version ? this.config._version : '0.0.0'} 
      The latest version is ${SCHEMA_VERSION}
      Please update your configuration.`);
    } 
    else {
      const connectUrl = `${this.config.mqtt.protocol}://${this.config.mqtt.host}:${this.config.mqtt.port}`;
      const connectionParams:mqtt.IClientOptions = {
        clientId: `${PLATFORM_NAME}_${os.hostname()}`,
        clean: false,
        connectTimeout: 4000,
        reconnectPeriod: 1000,
      };

      if(this.config.mqtt.user) {
        connectionParams.username = this.config.mqtt.user;
      }

      if(this.config.mqtt.password) {
        connectionParams.password = this.config.mqtt.password;
      }

      this.rfbridgeResultsTopic = `tele/${this.config.rfbridge.topic}/RESULT`;
      this.rfbridgeBootTopic = `tele/${this.config.rfbridge.topic}/INFO3`;

      this.mqttClient = mqtt.connect(connectUrl, connectionParams);

      const connectCallback = () => {
        this.log.debug(Date.now()+' MQTT Connected');
        if(this.mqttClient) {
          this.mqttClient.subscribe([this.rfbridgeResultsTopic, this.rfbridgeBootTopic], () => {
            this.log.debug(Date.now()+` Subscribed to topic '${this.rfbridgeResultsTopic}'`);
          });

          //Make sure that code sniffing is on
          this.mqttClient.publish(`cmnd/${this.config.rfbridge.topic}/rfraw`, 'AAA655');
        }
      };

      this.mqttClient.on('connect', connectCallback);

      this.mqttClient.on('reconnect', connectCallback);
    }


    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.log.debug(Date.now()+' Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.initialize();
      this.log.debug(Date.now()+' Finished initializing ceiling fan platform');
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  private removeUnusedAccessoriesFromCache() {
    //Remove any cached remotes that aren't in the config anymore.
    this.accessories.forEach(existingAccessory=>{
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
    });
  }

  initialize() {
    this.log.debug(Date.now()+' Initializing.');

    if(!(this.config._version && this.config._version === SCHEMA_VERSION )) {
      this.removeUnusedAccessoriesFromCache();
    }
    else if(this.config.rooms && Array.isArray(this.config.rooms)) {
      // loop over the discovered devices and register each one if it has not already been registered
      for (const roomConfig of this.config.rooms) {
        if(!roomConfig._id) {
          roomConfig._id = Date.now();
        }
        const uuid = this.api.hap.uuid.generate(roomConfig._id.toString());

        if(this.initializedRemotes.indexOf(uuid)<0) {

          this.initializedRemotes.push(uuid);

          // see if an accessory with the same uuid has already been registered and restored from
          // the cached devices we stored in the `configureAccessory` method above
          const existingAccessoryIndex = this.accessories.findIndex(accessory => accessory.UUID === uuid);
  
          const remote: CeilingFanRemote = (()=>{
            if (existingAccessoryIndex >= 0) {
              // the accessory already exists
              const existingAccessory = this.accessories.splice(existingAccessoryIndex, 1)[0];
    
              //Check if the display name has been updated
              if(roomConfig.name === existingAccessory.displayName) {
                this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
              }
              else {
                this.log.info(`Restoring existing accessory from cache: ${roomConfig.name} (formerly ${existingAccessory.displayName})`);
                existingAccessory.displayName = roomConfig.name;
                existingAccessory._associatedHAPAccessory.displayName = roomConfig.name;
              }
    
              // Update the context to make sure the current settings are in the context
              existingAccessory.context.config = roomConfig;
              this.api.updatePlatformAccessories([existingAccessory]);
    
              return new CeilingFanRemote(this, existingAccessory);
  
              //this.remotes[remoteConfig.remote_id] = new CeilingFanRemote(this, existingAccessory);
            }
            else {
              // the accessory does not yet exist, so we need to create it
              this.log.info('Adding new accessory:', roomConfig.name);
    
              // create a new accessory
              const accessory = new this.api.platformAccessory(roomConfig.name, uuid);
              accessory.context.config = roomConfig;
              //this.remotes[remoteConfig.remote_id] = new CeilingFanRemote(this, accessory);
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);

              return new CeilingFanRemote(this, accessory);
            }
          })();

          this.rooms.push(remote);

          for(const remote_id of roomConfig.remote_ids) {
            if(!(this.remotes[remote_id] && Array.isArray(this.remotes[remote_id]))) {
              this.remotes[remote_id] = [];
            }
            this.remotes[remote_id].push(remote);
          }
          
        }
        else {
          this.log.error(`Already initialized a room with id ${roomConfig._id}. Room ID must be unique.`);
        }
      }

      if(this.mqttClient) {
        this.mqttClient.on('message', (topic, payload) => {
          if(topic===this.rfbridgeResultsTopic) {
            //Parse rfraw data;
            const rfraw = JSON.parse(payload.toString()).RfRaw;
            if(rfraw && rfraw.Data) {
              const message = rfraw.Data as string;
              this.log.debug(Date.now()+' Received Message:', topic, message);
  
              if(message.substring(2, 4)==='A6' && message.substring(6, 8)===this.config.rfbridge.protocol) {
  
                this.log.debug(Date.now()+' Parsing Message:', message);
                const uartPayload = message.substring(8, message.length-2);
  
                const bytes = uartPayload.match(/../g);
                if(bytes) {
                  const binaryString = bytes.map(byte=>{
                    return parseInt(byte, 16).toString(2).padStart(8, '0');
                  }).join('');
  
                  const parsedBinary = binaryString.match(/^1(.{40})00(.{10})11(.{10})0.*/);
                  if(parsedBinary !== null ) {
                    // const command = parsedBinary[2];
                    // const iCommand = parsedBinary[3];
                    // this.log.debug(Date.now()+'   to binary -> ', binaryString, {room, command, iCommand, commandNum: parseInt(command, 2)});
  
                    const remote = parsedBinary[1];
                    const command = parseInt(parsedBinary[2], 2);
  
                    if(this.remotes[remote]) {
                      this.remotes[remote].forEach(accessory=>{
                        this.log.debug(Date.now()+` Sending command (${command}) to ${accessory.config.name}`);

                        accessory.update(command)
                      });
                    }
                  }
                }
              }
            }
          }
          else if(topic===this.rfbridgeBootTopic) {
            //Make sure that code sniffing is on
            if(this.mqttClient) {
              this.mqttClient.publish(`cmnd/${this.config.rfbridge.topic}/rfraw`, 'AAA655');
            }
          }
        });
      }


      //Add event listener to remotes for transmitting changes to mqtt
      Object.values(this.rooms).forEach(room=>{
        room.addListener('update', props=>{
          const command = commands[props.parameter][props.value];
          
          this.log.debug(Date.now()+` Recieved update from ${room.config.name}: ${JSON.stringify(props)}`, command);

          if(command && this.mqttClient) {

            const mqttClient = this.mqttClient;
            const commandCallback = ()=>{
              this.log.debug(Date.now()+` Sending command: ${room.config.name} ${props.parameter} (${props.value})`, hexCommand(props.remote, command));
              mqttClient.publish(`cmnd/${this.config.rfbridge.topic}/rfraw`, hexCommand(props.remote, command));
            }
            commandCallback.bind(this);

            this.debounceQueue.queue(`${props.remote}/${props.parameter}`, commandCallback)
          }
        });
      });

      //Remove any cached remotes that aren't in the config anymore.
      this.removeUnusedAccessoriesFromCache();
    }
  }
}
