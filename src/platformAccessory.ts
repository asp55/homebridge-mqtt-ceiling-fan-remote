import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { CeilingFanRemotePlatform } from './platform';
import EventEmitter from 'node:events';

const BrightnessLevels = 8;
const FanSpeeds = 3;

type FanActive = 0 | 1;

interface accessoryState {
  LightOn:boolean; 
  LightBrightness:number;
  FanOn: FanActive;
  FanSpeed: number;
}

interface accessoryStateUpdate {
  LightOn?:boolean; 
  LightBrightness?:number;
  FanOn?: FanActive;
  FanSpeed?: number;
}

type Callback = ()=>unknown;
type optionalCallback = null | Callback;

interface accessoryUpdateDebouncer {
  LightOn?:NodeJS.Timeout; 
  LightBrightness?:NodeJS.Timeout;
  FanOn?: NodeJS.Timeout;
  FanSpeed?: NodeJS.Timeout;
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
    LightBrightness: BrightnessLevels,
    FanOn: 0,
    FanSpeed: FanSpeeds,
  };

  private updateDebouncers:accessoryUpdateDebouncer = {};

  constructor(
    private readonly platform: CeilingFanRemotePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    super();
    
    this.platform.log.debug('Constructing ceiling fan remote with context:', this.accessory.context);
    this.name = this.accessory.context.config.name;
    this.serial = this.accessory.context.config._id.toString();

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Name, this.name)
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Andrew Parnell')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ceiling fan controls')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.serial);

    // INITIALIZE LIGHTBULB SERVICE
    (()=>{
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
        .onSet(this.setLightBrightness.bind(this))       // SET - bind to the 'setLightBrightness` method below
        .onGet(this.getLightBrightness.bind(this));       // SET - bind to the 'getLightBrightness` method below

    })();


    // INITIALIZE FAN SERVICE
    (()=>{
      // get the Fan service if it exists, otherwise create a new Fan service
      this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);

      // set the service name, this is what is displayed as the default name on the Home app
      this.fanService.setCharacteristic(this.platform.Characteristic.Name, `${this.name} Fan`);

      // register handlers for the Active Characteristic
      this.fanService.getCharacteristic(this.platform.Characteristic.Active)
        .onSet(this.setFanOn.bind(this))                // SET - bind to the `setFanOn` method below
        .onGet(this.getFanOn.bind(this));               // GET - bind to the `getFanOn` method below

      this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .onSet(this.setFanSpeed.bind(this))
        .onGet(this.getFanSpeed.bind(this));

    })();


    //Initialize the state from context
    if(this.accessory.context.state) {
      const updatedState = { ...this.accessory.context.state, ...this.accessoryState };
      this.accessoryState = { ...updatedState };
      

      const state = this.accessoryState;

      this.lightService.updateCharacteristic(this.platform.Characteristic.On, state.LightOn);
      this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, 100*state.LightBrightness/BrightnessLevels);

      this.fanService.updateCharacteristic(this.platform.Characteristic.Active, state.FanOn);
      this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 100*state.FanSpeed/FanSpeeds);
    }
    else {
      this.accessory.context.state = this.accessoryState;
      this.platform.api.updatePlatformAccessories([this.accessory]);
    }

  }

  private updateState(update:accessoryStateUpdate, afterUpdate:optionalCallback = null) {
    Object.keys(update).forEach(key=>{
      this.accessoryState[key] = update[key];
      this.emit('update', { remote:this.accessory.context.config.remote_ids[0], parameter:key, value:update[key] });

      if(this.updateDebouncers[key]) {
        clearTimeout(this.updateDebouncers[key]);
      }
      this.updateDebouncers[key] = setTimeout(()=>{

        //Update the accessory context

        this.accessory.context.state = this.accessoryState;

        
        this.platform.api.updatePlatformAccessories([this.accessory]);


        if(afterUpdate) {
          afterUpdate();
        }
      }, 50);
    });
  }

  get config() {
    return this.accessory.context.config;
  }

  async setLightOn(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.updateState({ LightOn: value as boolean });

    this.platform.log.debug(`${this.name}.setLightOn(${value})`);
  }

  async getLightOn(): Promise<CharacteristicValue> {
    const isOn = this.accessoryState.LightOn;

    //this.platform.log.debug(`${this.name}.getLightOn() -> ${isOn}`);

    return isOn;
  }

  async setLightBrightness(value: CharacteristicValue) {
    const newBrightness = Math.round((value as number)/100 * BrightnessLevels);
    const snapValue = Math.round(100*(newBrightness/BrightnessLevels));

    this.platform.log.debug(`${this.name}.setLightBrightness(${value}) -> ${newBrightness}`);

    if(newBrightness!==0) {
      //If the new brightness is 0, we're not going to actually save it to the state. So that if the light is just turned on we can return to the last brightness that was set.

      this.updateState(
        { LightBrightness: newBrightness },
        ()=>{
          //After debounce snap the value
          this.platform.log.debug(`${this.name}.snapLightBrightness(${value}) -> ${snapValue}%`);
          this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, snapValue);
        }
      );
    }

    
  }

  async getLightBrightness(): Promise<CharacteristicValue> {
    const brightness = this.accessoryState.LightOn ? 100*(this.accessoryState.LightBrightness/BrightnessLevels) : 0;

    //this.platform.log.debug(`${this.name}.getLightBrightness() -> ${brightness}`);

    return brightness;
  }

  async setFanOn(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.updateState({ FanOn: value as FanActive });

    this.platform.log.debug(`${this.name}.setFanOn(${value})`);
  }

  async getFanOn(): Promise<CharacteristicValue> {
    const isOn = this.accessoryState.FanOn;

    //this.platform.log.debug(`${this.name}.getFanOn() -> ${isOn}`);

    return isOn;
  }
  
  async setFanSpeed(value: CharacteristicValue) {
    const newSpeed = Math.round((value as number)/100 * FanSpeeds);
    const snapValue = Math.round(100*(newSpeed/FanSpeeds));
    this.platform.log.debug(`${this.name}.setFanSpeed(${value}) -> ${newSpeed} || ${snapValue}%`);

    if(newSpeed!==0) {
      //If the new speed is 0, we're not going to actually save it to the state. 
      // So that if the fan is just turned on we can return to the last speed that was set.

      this.updateState(
        { FanSpeed: newSpeed },
        ()=>{
          //After debounce snap the value
          this.platform.log.debug(`${this.name}.snapFanSpeed(${value}) -> ${snapValue}%`);
          this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, snapValue);
        }
      );
    }

  }

  async getFanSpeed(): Promise<CharacteristicValue> {
    const fanSpeed = this.accessoryState.FanOn ? 100*(this.accessoryState.FanSpeed/FanSpeeds) : 0;

    //this.platform.log.debug(`${this.name}.getFanSpeed() -> ${fanSpeed}`);

    return fanSpeed;
  }

  private get commands() {
    return [
      {
        label:'Fan Off',
        command:98,
        update:()=>{
          this.accessoryState.FanOn = 0;
        }
      },
      {
        label:'Fan Toggle On/Off',
        command:35,
        update:()=>{
          this.accessoryState.FanOn = this.accessoryState.FanOn===1 ? 0 : 1;
        }
      },
      {
        label:'Fan Speed 1',
        command:4,
        update:()=>{
          this.accessoryState.FanOn = 1;
          this.accessoryState.FanSpeed = 1;
        }
      },
      {
        label:'Fan Speed 2',
        command:32,
        update:()=>{
          this.accessoryState.FanOn = 1;
          this.accessoryState.FanSpeed = 2;
        }
      },
      {
        label:'Fan Speed 3',
        command:64,
        update:()=>{
          this.accessoryState.FanOn = 1;
          this.accessoryState.FanSpeed = 3;
        }
      },
      {
        label:'fanMin',
        command:2,
        update:()=>{
          this.accessoryState.FanOn = 1;
          this.accessoryState.FanSpeed = 1;
        }
      },
      {
        label:'fanMax',
        command:66,
        update:()=>{
          this.accessoryState.FanOn = 1;
          this.accessoryState.FanSpeed = 3;
        }
      },
      {
        label:'fanUp',
        command:513,
        update:()=>{
          this.accessoryState.FanOn = 1;
          this.accessoryState.FanSpeed = Math.min(this.accessoryState.FanSpeed+1, FanSpeeds);
        }
      },
      {
        label:'fanDown',
        command:514,
        update:()=>{
          this.accessoryState.FanOn = 1;
          this.accessoryState.FanSpeed = Math.max(this.accessoryState.FanSpeed-1, 1);
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
          this.accessoryState.LightBrightness = 1;
        }
      },
      {
        label:'Light 25.0% aka level 2',
        command:11,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = 2;
        }
      },
      {
        label:'Light 37.5% aka level 3',
        command:12,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = 3;
        }
      },
      {
        label:'Light 50.0% aka level 4',
        command:13,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = 4;
        }
      },
      {
        label:'Light 62.5% aka level 5',
        command:14,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = 5;
        }
      },
      {
        label:'Light 75.0% aka level 6',
        command:15,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = 6;
        }
      },
      {
        label:'Light 87.5% aka level 7',
        command:72,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = 7;
        }
      },
      {
        label:'Light 100.0% aka level 8',
        command:73,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = 8;
        }
      },
      {
        label:'lightMin',
        command:9,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = 1;
        }
      },
      {
        label:'lightMax',
        command:74,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = BrightnessLevels;
        }
      },
      {
        label:'lightUp',
        command:137,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = Math.min(this.accessoryState.LightBrightness+1, BrightnessLevels);
        }
      },
      {
        label:'lightDown',
        command:265,
        update:()=>{
          this.accessoryState.LightOn = true;
          this.accessoryState.LightBrightness = Math.max(this.accessoryState.LightBrightness-1, 1);
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
    const _command = this.commands.find(c=>c.command===command);
    if(_command) {
      this.platform.log.debug(_command.label);

      _command.update();

      this.lightService.updateCharacteristic(this.platform.Characteristic.On, this.accessoryState.LightOn);
      this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, 100*this.accessoryState.LightBrightness/BrightnessLevels);

      this.fanService.updateCharacteristic(this.platform.Characteristic.Active, this.accessoryState.FanOn);
      this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 100*this.accessoryState.FanSpeed/FanSpeeds);
    }
  }
  

}
