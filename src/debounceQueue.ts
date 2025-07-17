export default class DebounceQueue {
  private _delay:number = 300;
  private _timeout:NodeJS.Timeout|null;
  private _queue:string[];
  private _queueCallbacks:(()=>void)[];

  constructor() {
    this._timeout = null;
    
    this._queue = [];
    this._queueCallbacks = [];
  }

  queueContains(key:string):boolean {
    const queueIndex = this._queue.indexOf(key);
    return queueIndex > -1;
  }

  queue(key:string, callback:()=>void) {

    const queueIndex = this._queue.indexOf(key);

    if(queueIndex>=0) {
      if(queueIndex===0 && this._timeout) {
        clearTimeout(this._timeout);
        this._timeout = null;
      }
      this._queue.splice(queueIndex,1);
      this._queueCallbacks.splice(queueIndex,1);
    }



    const timeoutCallback = ()=>{
      this._queue.splice(0,1);
      this._queueCallbacks.splice(0,1);

      callback();

      if(this._queueCallbacks.length > 0) {
        this._timeout = setTimeout(this._queueCallbacks[0], this._delay);
      }
      else {
        this._timeout = null;
      }
    };

    this._queue.push(key);
    this._queueCallbacks.push(timeoutCallback);

    if(!this._timeout) {
      this._timeout = setTimeout(this._queueCallbacks[0], this._delay);
    }
  }
}