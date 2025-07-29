import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { CeilingFanRemotePlatform } from './platform';
import EventEmitter from 'node:events';



const BrightnessLevels = 8;
const FanSpeeds = 3;

type FanActive = 0 | 1;

const FanStateActive:FanActive = 1;
const FanStateInactive:FanActive = 0;


const LightLevels = [12, 25, 37, 50, 62, 75, 87, 100];


interface accessoryState {
  LightOn:boolean;
  Brightness:number;
  FanOn: FanActive;
  Speed: number;
}


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CeilingFanRemote extends EventEmitter {
  private name: string;
  private serial: string;
  private lightService: Service;
  private fanService: Service;


  private accessoryState:accessoryState = {
    LightOn: false,
    Brightness: 100,
    FanOn: 0,
    Speed: 100,
  };

  constructor(
    private readonly platform: CeilingFanRemotePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    super();
    
    //this.platform.log.debug(Date.now()+" "+'Constructing ceiling fan remote with context:', this.accessory.context);
    this.name = this.accessory.context.config.name;
    this.serial = this.accessory.context.config._id.toString();

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Name, this.name)
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Andrew Parnell')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ceiling fan controls')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.serial);

    // INITIALIZE LIGHTBULB SERVICE

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    this.lightService = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    this.lightService.setCharacteristic(this.platform.Characteristic.Name, `${this.name} Light`);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.lightService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setLightOn.bind(this))                // SET - bind to the `setLightOn` method below
      .onGet(this.getLightOn.bind(this));               // GET - bind to the `getLightOn` method below

    // register handlers for the Brightness Characteristic
    this.lightService.getCharacteristic(this.platform.Characteristic.Brightness)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 100/BrightnessLevels
      })
      .onSet(this.setLightBrightness.bind(this))       // SET - bind to the 'setLightBrightness` method below
      .onGet(this.getLightBrightness.bind(this));       // SET - bind to the 'getLightBrightness` method below
    


    // INITIALIZE FAN SERVICE
    // get the Fan service if it exists, otherwise create a new Fan service
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);

    // set the service name, this is what is displayed as the default name on the Home app
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, `${this.name} Fan`);

    // register handlers for the Active Characteristic
    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setFanActive.bind(this))                // SET - bind to the `setFanActive` method below
      .onGet(this.getFanActive.bind(this));               // GET - bind to the `getFanActive` method below

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 100/FanSpeeds,
        validValues: null //[0, 100/FanSpeeds, 200/FanSpeeds, 100]
      })
      .onSet(this.setFanSpeed.bind(this))
      .onGet(this.getFanSpeed.bind(this));

    



  



    //Initialize the state from context
    if(this.accessory.context.state) {
      Object.keys(this.accessoryState).forEach(stateKey=>{
        if(stateKey in this.accessory.context.state) {
          this.accessoryState[stateKey] = this.accessory.context.state[stateKey];
        }
      });
      
      // set characteristic to trigger the commands and make sure the digital model of these fans matches the reality.
      this.lightService.setCharacteristic(this.platform.Characteristic.Brightness, this.accessoryState.Brightness);
      this.lightService.setCharacteristic(this.platform.Characteristic.On, this.accessoryState.LightOn);

      this.fanService.setCharacteristic(this.platform.Characteristic.RotationSpeed, this.accessoryState.Speed);
      this.fanService.setCharacteristic(this.platform.Characteristic.Active, this.accessoryState.FanOn);
    }
    else {
      this.accessory.context.state = this.accessoryState;
      this.platform.api.updatePlatformAccessories([this.accessory]);
    }

  }

  get config() {
    return this.accessory.context.config;
  }



  async getLightOn(): Promise<CharacteristicValue> {
    this.platform.log.debug(Date.now()+` ${this.name}.getLightOn() -> return: ${this.accessoryState.LightOn}`);
    return this.accessoryState.LightOn;
  }

  async getLightBrightness(): Promise<CharacteristicValue> {
    this.platform.log.debug(Date.now()+` ${this.name}.getLightBrightness() -> return: ${this.accessoryState.Brightness}`);
    return this.accessoryState.Brightness;
  }

  async getFanActive(): Promise<CharacteristicValue> {
    this.platform.log.debug(Date.now()+` ${this.name}.getFanActive() -> return: ${this.accessoryState.FanOn}`);

    return this.accessoryState.FanOn;
  }

  async getFanSpeed(): Promise<CharacteristicValue> {
    this.platform.log.debug(Date.now()+` ${this.name}.getFanSpeed() -> return: ${this.accessoryState.Speed}`);

    return this.accessoryState.Speed;
  }
  


  async setLightOn(value: CharacteristicValue) {
    this.platform.log.debug(Date.now()+` ${this.name}.setLightOn(${value})`);
    this.accessoryState.LightOn = value as boolean;
    
    //Update the cache
    this.saveState();

    //Send command
    this.emit('update', { remote:this.accessory.context.config.remote_ids[0], parameter:'Brightness', value:value ? this.accessoryState.Brightness : 0 });

  }

  async setLightBrightness(value: CharacteristicValue) {
    this.platform.log.debug(Date.now()+` ${this.name}.setLightBrightness(${value})`);

    const newBrightness = value as number;

    if(newBrightness > 0) {
      this.accessoryState.Brightness = newBrightness;
    }

    //Update the cache
    this.saveState();

    //Send command
    this.emit('update', { remote:this.accessory.context.config.remote_ids[0], parameter:'Brightness', value:newBrightness });
  }


  async setFanActive(value: CharacteristicValue) {
    this.platform.log.debug(Date.now()+` ${this.name}.setFanActive(${value})`);

    this.accessoryState.FanOn = value as FanActive;
    
    //Update the cache
    this.saveState();

    //Send command
    this.emit('update', { remote:this.accessory.context.config.remote_ids[0], parameter:'Speed', value:value === FanStateActive ? this.accessoryState.Speed/(100/3) : 0 });

  }

  async setFanSpeed(value: CharacteristicValue) {
    this.platform.log.debug(Date.now()+` ${this.name}.setFanSpeed(${value})`);

    const newSpeed = value as number;
    
    if(newSpeed > 0) {
      this.accessoryState.Speed = newSpeed;
    }

    //Update the cache
    this.saveState();

    //Send command
    this.emit('update', { remote:this.accessory.context.config.remote_ids[0], parameter:'Speed', value:Math.round(newSpeed/(100/3)) });



  }


  private get commands() {
    return [
      {
        label:'Fan Off',
        command:98,
        update:()=>{
          this.accessoryState.FanOn = FanStateInactive;
        }
      },
      {
        label:'Fan Toggle On/Off',
        command:35,
        update:()=>{
          const newState = this.accessoryState.FanOn===FanStateActive ? FanStateInactive : FanStateActive;
          this.accessoryState.FanOn = newState;
        }
      },
      {
        label:'Fan Speed 1',
        command:4,
        update:()=>{
          this.accessoryState.FanOn = FanStateActive;
          this.accessoryState.Speed = 100/3;
        }
      },
      {
        label:'Fan Speed 2',
        command:32,
        update:()=>{
          this.accessoryState.FanOn = FanStateActive;
          this.accessoryState.Speed = 200/3;
        }
      },
      {
        label:'Fan Speed 3',
        command:64,
        update:()=>{
          this.accessoryState.FanOn = FanStateActive;
          this.accessoryState.Speed = 100;
        }
      },
      {
        label:'fanMin',
        command:2,
        update:()=>{
          this.accessoryState.FanOn = FanStateActive;
          this.accessoryState.Speed = 100/3;
        }
      },
      {
        label:'fanMax',
        command:66,
        update:()=>{
          this.accessoryState.FanOn = FanStateActive;
          this.accessoryState.Speed = 100;
        }
      },
      {
        label:'fanUp',
        command:513,
        update:()=>{
          this.accessoryState.FanOn = FanStateActive;

          const newSpeed = Math.min(this.accessoryState.Speed+(100/3), 100);
          this.accessoryState.Speed = newSpeed;
        }
      },
      {
        label:'fanDown',
        command:514,
        update:()=>{
          this.accessoryState.FanOn = 1;

          const newSpeed = Math.min(this.accessoryState.Speed-(100/3), 100/3);
          this.accessoryState.Speed = newSpeed;
        }
      },
      {
        label:'Light On',
        command:138,
        update:()=>{
          this.accessoryState.LightOn = true;
        }
      },
      {
        label:'Light Off',
        command:266,
        update:()=>{
          this.accessoryState.LightOn = false;
        }
      },
      {
        label:'Light Toggle On/Off',
        command:768,
        update:()=>{
          this.accessoryState.LightOn = !this.accessoryState.LightOn;
        }
      },
      {
        label:'Light 12.5% aka level 1',
        command:10,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 12;
        }
      },
      {
        label:'Light 25.0% aka level 2',
        command:11,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 25;
        }
      },
      {
        label:'Light 37.5% aka level 3',
        command:12,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 37;
        }
      },
      {
        label:'Light 50.0% aka level 4',
        command:13,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 50;
        }
      },
      {
        label:'Light 62.5% aka level 5',
        command:14,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 62;
        }
      },
      {
        label:'Light 75.0% aka level 6',
        command:15,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 75;
        }
      },
      {
        label:'Light 87.5% aka level 7',
        command:72,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 87;
        }
      },
      {
        label:'Light 100.0% aka level 8',
        command:73,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 100;
        }
      },
      {
        label:'lightMin',
        command:9,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 12;
        }
      },
      {
        label:'lightMax',
        command:74,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.Brightness = 100;
        }
      },
      {
        label:'lightUp',
        command:137,
        update:()=>{
          this.accessoryState.LightOn = true;

          const currentLevelIndex = LightLevels.indexOf(this.accessoryState.Brightness);
          const nextLevelIndex = Math.min(LightLevels.length, currentLevelIndex+1);
          this.accessoryState.Brightness = LightLevels[nextLevelIndex];
        }
      },
      {
        label:'lightDown',
        command:265,
        update:()=>{
          this.accessoryState.LightOn = true;


          const currentLevelIndex = LightLevels.indexOf(this.accessoryState.Brightness);
          const prevLevelIndex = Math.max(0, currentLevelIndex-1);
          this.accessoryState.Brightness = LightLevels[prevLevelIndex];
        }
      },
      {
        label:'toggleDimming',
        command:5,
        update: ()=>{}
      },
      {
        label:'pair',
        command:65,
        update: ()=>{}
      },
    ];
  }

  public update(command:number): void {

    this.platform.log.debug(Date.now()+` ${this.name}.command(${command})`);
    const _command = this.commands.find(c=>c.command===command);
    if(_command) {
      this.platform.log.debug(Date.now()+` ${this.name} - Run Command ${_command.label}`);

      _command.update();

      this.lightService.updateCharacteristic(this.platform.Characteristic.On, this.accessoryState.LightOn);
      this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, this.accessoryState.Brightness);

      this.fanService.updateCharacteristic(this.platform.Characteristic.Active, this.accessoryState.FanOn);
      this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.accessoryState.Speed);
    }
  }
  
  private saveState():void {


    //Update the accessory context
    this.accessory.context.state = this.accessoryState;

    this.platform.api.updatePlatformAccessories([this.accessory]);
  }


}
