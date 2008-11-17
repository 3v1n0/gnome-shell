/* -*- mode: js2; js2-basic-offset: 4; -*- */

const Clutter = imports.gi.Clutter;
const Tweener = imports.tweener.tweener;

const DEFAULT_BUTTON_COLOR = new Clutter.Color();
DEFAULT_BUTTON_COLOR.from_pixel(0xeeddccff);

const DEFAULT_PRESSED_BUTTON_COLOR = new Clutter.Color();
DEFAULT_PRESSED_BUTTON_COLOR.from_pixel(0xccbbaaff);

// Time for animation making the button darker
const ANIMATION_TIME = 0.3;

const NO_OPACITY = 0;

const PARTIAL_OPACITY = 0.4 * 255;

const FULL_OPACITY = 255;

function Button(text, button_color, pressed_button_color, min_width, min_height) {
    this._init(text, button_color, pressed_button_color, min_width, min_height);
}

Button.prototype = {
    _init : function(text, button_color, pressed_button_color, stays_pressed, min_width, min_height) {

        this._button_color = button_color  
        if (button_color == null)                   
            this._button_color = DEFAULT_BUTTON_COLOR;

        this._pressed_button_color = pressed_button_color  
        if (pressed_button_color == null)
            this._pressed_button_color = DEFAULT_PRESSED_BUTTON_COLOR;

        if (stays_pressed == null)
            stays_pressed = false  
        if (min_width == null)
            min_width = 0;
        if (min_height == null)
            min_height = 0;
        
        // if stays_pressed is true, this.active will be true past the first release of a button, untill a subsequent one (the button
        // is unpressed) or untill release() is called explicitly
        this._active = false; 
        this._is_between_press_and_release = false; 
        this._mouse_is_over_button = false;

        this.button = new Clutter.Group({reactive: true});
        this._background = new Clutter.Rectangle({ color: this._button_color});
        this._pressed_background = new Clutter.Rectangle({ color: this._pressed_button_color, opacity: NO_OPACITY});
        this._label = new Clutter.Label({ font_name: "Sans Bold 16px",
	  			         text: text});
	this._label.set_position(5, 5);
        let background_width = Math.max(this._label.get_width()+10, min_width);
        let background_height = Math.max(this._label.get_height()+10, min_height);
        this._background.set_width(background_width)
        this._background.set_height(background_height)
        this._pressed_background.set_width(background_width)
        this._pressed_background.set_height(background_height)
        this.button.add_actor(this._background);
        this.button.add_actor(this._pressed_background);
        this.button.add_actor(this._label);
        let me = this; 
        this.button.connect('button-press-event',
	    function(o, event) {     
                me._is_between_press_and_release = true;  
	        Tweener.addTween(me._pressed_background,
			        { time: ANIMATION_TIME,
			          opacity: FULL_OPACITY,
			          transition: "linear"
			        });      
		return false;
            });
        this.button.connect('button-release-event',
	    function(o, event) {      
                me._is_between_press_and_release = false; 
                if (!stays_pressed || me._active) {
                    me.release();
                } else {
                    me._active = true;
                }
		return false;
            });
        this.button.connect('enter-event',
	    function(o, event) {
                me._mouse_is_over_button = true; 
                if (!me._active) {
                    Tweener.removeTweens(me._pressed_background);         
                    me._pressed_background.set_opacity(PARTIAL_OPACITY); 
                } 
		return false;
            });
        this.button.connect('leave-event',
	    function(o, event) {     
                me._is_between_press_and_release = false;     
                me._mouse_is_over_button = false;
                if (!me._active) {
                    Tweener.removeTweens(me._pressed_background); 
                    me._pressed_background.set_opacity(NO_OPACITY);
                }
		return false;
            });
    },

    release : function() {
        if (!this._is_between_press_and_release) {  
            this._active = false;
            Tweener.removeTweens(this._pressed_background);  
            if (this._mouse_is_over_button) {       
                this._pressed_background.set_opacity(PARTIAL_OPACITY);
            } else {
                this._pressed_background.set_opacity(NO_OPACITY);
            }
        }
    }
}

