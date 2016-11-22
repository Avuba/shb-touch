import { default as utils } from './utils/utils';
import { default as lodash } from './utils/lodash';


let defaults = {
  config: {
    // main container for defining the boundaries of the scrollable area and setting the event
    // listeners. is expected to be a simple DOM node
    container: null,

    // capture touch events before they can reach other DOM nodes
    capture: false,

    // allow momentum based scrolling after touchend
    momentum: true,

    // decide what axis to allow scrolling on, gets translated into an array by the class
    // constructor
    axis: 'xy',

    // prevent the default action of all touchStart/Move/End/Cancel events
    preventDefault: false,

    // stop further propagation of all touchStart/Move/End/Cancel events
    stopEvents: false,

    // "stopEventsOnDirectionLock" is relevant if more touch/scroll libraries are at the same spot
    // (for example through nested elements) and only the one element using ShbTouch should move
    // along the axis defined using the "axis" parameter. it has two possible effects:
    //
    // - #1: in case the user moves along the axis defined using the "axis" parameter, we prevent
    // the default action and stop all event propagation
    //
    // - #2: in case the user moves along the opposite axis, ignore all inputs till the user lifted
    // his finger and started a new touch flow
    stopEventsOnDirectionLock: false,

    // don't trigger momentum scrolling in case the distance between touchstart and touchEnd is less
    // than minPxForMomentum
    minPxForMomentum: 3,

    // maximal number of points we check for calculating the speed of momentum on touchEnd
    maxPointsForMomentum: 3,

    // if the time between the last touchmove event and touchEnd is larger than this value, we
    // don't start the momentum
    maxTimeDiffForMomentum: 66
  },

  private: {
    boundHandlers: {},
    ignoreMovements: false,
    stopEvents: false,
    moveCount: 0,
    activeFinger: 0,
    startPoint: null,
    axis: ['x', 'y'],
    path: {
      x: [],
      y: []
    },
    speed: {
      x: [],
      y: []
    },
    timestamps: {
      start: 0,
      move: 0,
      end: 0
    },
    direction: {
      x: 0, // 1 = left to right, -1 = right to left
      y: 0 // 1 = top to bottom, -1 = bottom to top
    },
    prevDirection: {
      x: 0,
      y: 0
    }
  },

  state: {
    isTouchActive: false,
    isScrollingDisabled: false
  }
};


let events = {
  pushBy: 'pushBy',
  touchStart: 'touchStart',
  touchEnd: 'touchEnd',
  touchEndWithMomentum: 'touchEndWithMomentum'
};


export default class ShbTouch {
  constructor(config) {
    this._config = lodash.cloneDeep(defaults.config);
    this._private = lodash.cloneDeep(defaults.private);
    this._state = lodash.cloneDeep(defaults.state);

    if (config) lodash.merge(this._config, config);

    this._private.axis = this._config.axis.split('');
    // it's not possible to lock the direction in case the has allowed the X and the Y axis
    if (this._private.axis.length > 1) this._config.stopEventsOnDirectionLock = false;
    // "stopEventsOnDirectionLock" forces "capture" to be true as this is the only way to actually
    // stop touch events from reaching potential elements below
    if (this._config.stopEventsOnDirectionLock) this._config.capture = true;

    this.events = events;
    utils.addEventTargetInterface(this);
    this._bindEvents();
  }


  // PUBLIC


  disableScrolling(isDisabled) {
    this._state.isScrollingDisabled = isDisabled;

    if (this._state.isScrollingDisabled && this._state.isTouchActive) {
      // clear the path so every future touch starts from a clean slate
      this._forXY((xy) => {
        this._private.path[xy].length = 0;
        this._private.speed[xy].length = 0;
      });

      // publish a touchEnd event so that subscribers aren't left under the impression that there
      // is still a meaningful touch hanging
      if (this._state.isTouchActive) {
        this.dispatchEvent(new Event(events.touchEnd));
        this._state.isTouchActive = false;
      }
    }
  }


  destroy() {
    this._unbindEvents();
    this._config.container = null;
  }


  // TOUCH RELATED


  _bindEvents() {
    this._private.boundHandlers = {
      touchstart: this._onTouchStart.bind(this),
      touchmove: this._onTouchMove.bind(this),
      touchend: this._onTouchEnd.bind(this),
      touchcancel: this._onTouchCancel.bind(this)
    };

    lodash.forEach(this._private.boundHandlers, (handler, eventName) => {
      this._config.container.addEventListener(eventName, handler, this._config.capture);
    });
  }


  _unbindEvents() {
    lodash.forEach(this._private.boundHandlers, (handler, eventName) => {
      this._config.container.removeEventListener(eventName, handler, this._config.capture);
    });
  }


  _checkForNewStartParams(event, forceNewFinger) {
    // event.changedTouches always contains only one finger - the finger which moved last and
    // therefore triggered the touchstart/move event. we store the identifier and use it for
    // getting the active finger index inside event.touches (which can contain multiple fingers)
    let identifier = event.changedTouches[0].identifier,
      newActiveFinger = 0;

    lodash.forEach(event.touches, (touch, index) => {
      if (touch.identifier === identifier) newActiveFinger = index;
    });

    if (this._private.activeFinger !== newActiveFinger || forceNewFinger) {
      this._private.activeFinger = newActiveFinger;

      let newTouchPoint = this._eventToPoint(event);
      this._private.startPoint = newTouchPoint;
      this._private.timestamps.start = this._private.timestamps.move = Date.now();

      this._forXY((xy) => {
        // reset previous touch flow
        this._private.path[xy].length = 0;
        this._private.speed[xy].length = 0;

        this._private.direction[xy] = 0;
        this._private.prevDirection[xy] = 0;

        // start new touch flow
        this._private.path[xy].push(newTouchPoint[xy]);
      });
    }
  }


  _onTouchStart(event) {
    if (this._config.preventDefault) event.preventDefault();
    if (this._config.stopEvents) utils.stopEvent(event);
    if (this._state.isScrollingDisabled) return;

    this._state.isTouchActive = true;
    this.dispatchEvent(new Event(events.touchStart));

    // don't reset the following values in case more than one finger is active, we assume that the
    // necessary checks if the movement should be ignored have already happened
    if (event.touches.length < 2) {
      this._private.ignoreMovements = false;
      this._private.stopEvents = false;
      this._private.moveCount = 0;
    }

    this._checkForNewStartParams(event, true);
  }


  _onTouchMove(event) {
    if (this._config.preventDefault) event.preventDefault();
    if (this._config.stopEvents) utils.stopEvent(event);
    if (this._state.isScrollingDisabled || this._private.ignoreMovements) return;

    // we need to re-create all stored touch and path properties in case the finger changed. this
    // function checks if a new finger is active
    this._checkForNewStartParams(event);

    let newTouchPoint = this._eventToPoint(event);

    // if "stopEventsOnDirectionLock" is true, ShbTouch will check the first two touchmove events
    // to determine the scroll direction and will not send out any "pushBy" events till then
    if (this._config.stopEventsOnDirectionLock && this._private.moveCount < 2) {
      this._private.moveCount++;

      // stop the touchMove event from further propagation until the direction has been determined
      // so any underlying scrollable elements do not move as well
      if (this._private.moveCount < 2) {
        event.preventDefault();
        utils.stopEvent(event);
        return;
      }

      let targetAxis = this._private.axis[0],
        oppositeAxis = targetAxis === 'x' ? 'y' : 'x',
        distanceOnTargetAxis = Math.abs(newTouchPoint[targetAxis] - this._private.startPoint[targetAxis]),
        distanceOnOppositeAxis = Math.abs(newTouchPoint[oppositeAxis] - this._private.startPoint[oppositeAxis]);

      // in case the user does not move along the axis defined using the "axis" parameter, stop
      // at this spot and ignore all further events (until a new touchstart has happened)
      if (distanceOnOppositeAxis > distanceOnTargetAxis) {
        this._private.ignoreMovements = true;
        return;
      }

      // in case the user follows the defined axis, stop the touchMove event from further
      // propagation so any underlying scrollable elements do not move as well
      this._private.stopEvents = true;
    }

    if (this._private.stopEvents) {
      event.preventDefault();
      utils.stopEvent(event);
    }

    let pushBy = {
        x: { direction: 0, px: 0 },
        y: { direction: 0, px: 0 }
      },
      newDirection = {},
      newTimeStamp = Date.now(),
      timeDiff = newTimeStamp - this._private.timestamps.move;

    this._forXY((xy) => {

      // CALCULATE AND STORE PARAMTERS FOR FURTHER PROCESSING

      let relativeDelta = this._private.path[xy].length ? newTouchPoint[xy] - lodash.last(this._private.path[xy]) : 0;
      this._private.path[xy].push(newTouchPoint[xy]);
      this._private.speed[xy].push({
        px: Math.abs(relativeDelta),
        ms: timeDiff
      });

      // SET DIRECTION

      // relativeDelta === 0 usually happens when the user changes direction and the finger remains
      // at the same place for a few milliseconds. we asume a direction change and simple invert
      // the current direction
      if (relativeDelta === 0) {
        newDirection[xy] = this._private.direction[xy] * -1;
      }
      // we calculate the direction based on the delta value otherwise
      else {
        newDirection[xy] = relativeDelta < 0 ? -1 : 1;
      }

      // PROCSS DIRECTION CHANGE

      // check if direction has changed and update the movement related parameters if yes.
      // prevDirection !== 0 helps avoiding changing the direction on the first call of the
      // 'touchmove' event
      if (newDirection[xy] !== this._private.direction[xy]
          && this._private.prevDirection[xy] !== 0
          && this._private.prevDirection[xy] !== -0) {
        // clear all previously stored values as they are now invalid
        this._private.path[xy].length = 0;
        this._private.speed[xy].length = 0;

        // start touch path again with current point as origin
        this._private.path[xy].push(newTouchPoint[xy]);
      }

      // COMMIT VALUES TO PUSHBY OBJECT

      pushBy[xy].direction = newDirection[xy];
      pushBy[xy].px = Math.abs(relativeDelta);
    });

    this._private.prevDirection = this._private.direction
    this._private.direction = newDirection;
    this._private.timestamps.move = newTimeStamp;

    if (pushBy.x.px === 0 && pushBy.y.px === 0) return;
    this.dispatchEvent(new Event(events.pushBy), pushBy);
  }


  _onTouchEnd(event) {
    if (this._config.preventDefault) event.preventDefault();
    if (this._config.stopEvents) utils.stopEvent(event);
    if (this._state.isScrollingDisabled) return;

    // this forces the re-creation of all touch properties when calling _checkForNewStartParams()
    this._private.activeFinger = -1;

    // we don't trigger velocity scrolling or any other touchend interaction till we're sure that
    // there are no more active fingers
    if (event.touches.length > 0) return;

    this._state.isTouchActive = false;
    this.dispatchEvent(new Event(events.touchEnd));

    if (!this._config.momentum) return;
    if (Date.now() - this._private.timestamps.move > this._config.maxTimeDiffForMomentum) return;

    let momentum = {
      x: { direction: 0, pxPerFrame: 0 },
      y: { direction: 0, pxPerFrame: 0 }
    };

    this._forXY((xy) => {

      // CHECK IF DISTANCE FROM START IS LARGE ENOUGH

      let distanceFromStart = Math.abs(lodash.last(this._private.path[xy]) - this._private.path[xy][0]);
      if (distanceFromStart < this._config.minPxForMomentum) return;

      // CALCULATE VELOCITY

      // we try to determine the speed of momentum by calculating the average scroll speed of the
      // last maxPointsForMomentum touchmove events. we choose less pointsToConsider in case the
      // last user interaction had less than maxPointsForMomentum touchmove events
      let speedPoints = this._private.speed[xy],
        pointsToConsider = speedPoints.length < this._config.maxPointsForMomentum ? speedPoints.length : this._config.maxPointsForMomentum,
        avgPxPerFrame = 0;

      // calculate the average values by iterating of the 'speedPoints' array within the range of
      // 'pointsToConsider'
      for (let i = speedPoints.length - 1; i >= speedPoints.length - pointsToConsider; i--) {
        avgPxPerFrame = avgPxPerFrame + (speedPoints[i].px / pointsToConsider);
      }

      // COMMIT VALUES TO VELOCITY OBJECT

      momentum[xy].direction = this._private.direction[xy];
      momentum[xy].pxPerFrame = avgPxPerFrame;
    });

    if (momentum.x.pxPerFrame > 0 || momentum.y.pxPerFrame > 0) {
      this.dispatchEvent(new Event(events.touchEndWithMomentum), momentum);
    }
  }


  _onTouchCancel(event) {
    if (this._config.preventDefault) event.preventDefault();
    if (this._config.stopEvents) utils.stopEvent(event);
    if (this._state.isScrollingDisabled) return;

    this._state.isTouchActive = false;
  }


  // HELPERS


  _forXY(toExecute) {
    this._private.axis.forEach(toExecute);
  }


  _eventToPoint(event) {
    return {
      x: event.touches[this._private.activeFinger].pageX,
      y: event.touches[this._private.activeFinger].pageY
    };
  }
}
