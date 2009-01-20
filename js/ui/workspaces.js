/* -*- mode: js2; js2-basic-offset: 4; tab-width: 4; indent-tabs-mode: nil -*- */

const Tweener = imports.tweener.tweener;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;
const Lang = imports.lang;

const Main = imports.ui.main;
const Overlay = imports.ui.overlay;
const Panel = imports.ui.panel;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Big = imports.gi.Big;
const GdkPixbuf = imports.gi.GdkPixbuf;

// Windows are slightly translucent in the overlay mode
const WINDOW_OPACITY = 0.9 * 255;
const FOCUS_ANIMATION_TIME = 0.15;

const WINDOWCLONE_BG_COLOR = new Clutter.Color();
WINDOWCLONE_BG_COLOR.from_pixel(0x000000f0);
const WINDOWCLONE_TITLE_COLOR = new Clutter.Color();
WINDOWCLONE_TITLE_COLOR.from_pixel(0xffffffff);

// Define a layout scheme for small window counts. For larger
// counts we fall back to an algorithm. We need more schemes here
// unless we have a really good algorithm.

// Each triplet is [xCenter, yCenter, scale] where the scale
// is relative to the width of the workspace.
const POSITIONS = {
        1: [[0.5, 0.5, 0.8]],
        2: [[0.25, 0.5, 0.4], [0.75, 0.5, 0.4]],
        3: [[0.25, 0.25, 0.33],  [0.75, 0.25, 0.33],  [0.5, 0.75, 0.33]],
        4: [[0.25, 0.25, 0.33],   [0.75, 0.25, 0.33], [0.75, 0.75, 0.33], [0.25, 0.75, 0.33]],
        5: [[0.165, 0.25, 0.28], [0.495, 0.25, 0.28], [0.825, 0.25, 0.28], [0.25, 0.75, 0.4], [0.75, 0.75, 0.4]]
};

// Spacing between workspaces. At the moment, the same spacing is used
// in both zoomed-in and zoomed-out views; this is slightly
// metaphor-breaking, but the alternatives are also weird.
const GRID_SPACING = 15;

function Workspace(workspaceNum) {
    this._init(workspaceNum);
}

Workspace.prototype = {
    _init : function(workspaceNum) {
        let me = this;
        let global = Shell.Global.get();

        this._workspaceNum = workspaceNum;
        this.actor = new Clutter.Group();

        let windows = global.get_windows().filter(this._isMyWindow, this);

        // Find the desktop window
        for (let i = 0; i < windows.length; i++) {
            if (windows[i].get_window_type() == Meta.WindowType.DESKTOP) {
                this._desktop = this._makeClone(windows[i]);
                break;
            }
        }
        // If there wasn't one, fake it
        if (!this._desktop)
            this._desktop = this._makeDesktopRectangle();

        let metaWorkspace = global.screen.get_workspace_by_index(workspaceNum);
        this._desktop.connect('button-press-event',
                              function(actor, event) {
                                  metaWorkspace.activate(event.get_time());
                                  Main.hide_overlay();
                              });
        this.actor.add_actor(this._desktop);

        // Create clones for remaining windows that should be
        // visible in the overlay
        this._windows = [this._desktop];
        for (let i = 0; i < windows.length; i++) {
            if (this._isOverlayWindow(windows[i])) {
                let clone = this._makeClone(windows[i], i);
                clone.connect("button-press-event",
                              function(clone, event) {
                                  clone.raise_top();
                                  me._activateWindow(clone.realWindow, event.get_time());
                              });
                clone.connect('enter-event', function (a, e) {
                    me._cloneEnter(clone, e);
                });
                clone.connect('leave-event', function (a, e) {
                    me._cloneLeave(clone, e);
                });
                this.actor.add_actor(clone);
                this._windows.push(clone);
            }
        }

        this._overlappedMode = !((this._windows.length-1) in POSITIONS);
        this._removeButton = null;
        this._visible = false;
    },

    // Checks if the workspace is empty (ie, contains only a desktop window)
    isEmpty : function() {
        return this._windows.length == 1;
    },

    // Change Workspace's removability.
    setRemovable : function(removable, buttonSize) {
        let global = Shell.Global.get();

        if (removable) {
            if (this._removeButton)
                return;

            this._removeButton = new Clutter.Texture({ width: buttonSize,
                                                       height: buttonSize,
                                                       reactive: true
                                                     });
            this._removeButton.set_from_file(global.imagedir + "remove-workspace.svg");
            this._removeButton.connect('button-press-event', Lang.bind(this, this._removeSelf));

            this.actor.add_actor(this._removeButton);

            if (this._visible) {
                this._removeButton.set_position(
                    this.gridX + (this._desktop.width * this.scale - this._removeButton.width) / 2,
                    this.gridY + (this._desktop.height * this.scale - this._removeButton.height) / 2);
                this._removeButton.set_opacity(0);
                Tweener.addTween(this._removeButton,
                                 { opacity: 255,
                                   time: Overlay.ANIMATION_TIME,
                                   transition: "easeOutQuad"
                                 });
            }
        } else {
            if (!this._removeButton)
                return;

            if (this._visible) {
                Tweener.addTween(this._removeButton,
                                 { opacity: 0,
                                   time: Overlay.ANIMATION_TIME,
                                   transition: "easeOutQuad",
                                   onComplete: this._removeRemoveButton,
                                   onCompleteScope: this
                                 });
            } else {
                this._removeButton.destroy();
                this._removeButton = null;
            }
        }
    },

    _removeRemoveButton : function() {
        this._removeButton.destroy();
        this._removeButton = null;
    },

    // Animate the full-screen to overlay transition.
    zoomToOverlay : function() {
        let global = Shell.Global.get();

        // Move the desktop into size/position
        this._desktop.set_position(this.fullSizeX, this.fullSizeY);
        Tweener.addTween(this._desktop,
                         { x: this.gridX,
                           y: this.gridY,
                           scale_x: this.scale,
                           scale_y: this.scale,
                           time: Overlay.ANIMATION_TIME,
                           transition: "easeOutQuad"
                         });

        // Likewise for each of the windows in the workspace. This
        // would be easier if we just positioned and scaled the entire
        // workspace group rather than going each window individually,
        // but if we do that then the windows of the active workspace
        // will trace out a curved path as they move into place, which
        // looks odd. Positioning everything independently lets us
        // move them in a straight line to their final destination.
        for (let i = 1; i < this._windows.length; i++) {
            let window = this._windows[i];

            let [xCenter, yCenter, fraction] = this._computeWindowPosition(i);
            xCenter = this.gridX + this.scale * (xCenter * global.screen_width);
            yCenter = this.gridY + this.scale * (yCenter * global.screen_height);

            let size = Math.max(window.width, window.height);
            let desiredSize = global.screen_width * fraction;
            let scale = Math.min(desiredSize / size, 1.0) * this.scale;

            window.set_position(this.fullSizeX + window.origX, this.fullSizeY + window.origY);
            Tweener.addTween(window,
                             { x: xCenter - 0.5 * scale * window.width,
                               y: yCenter - 0.5 * scale * window.height,
                               scale_x: scale,
                               scale_y: scale,
                               time: Overlay.ANIMATION_TIME,
                               opacity: WINDOW_OPACITY,
                               transition: "easeOutQuad"
                             });
        }

        // If the workspace is removable, animate in its removeButton
        if (this._removeButton) {
            this._removeButton.set_position(
                this.fullSizeX + (this._desktop.width - this._removeButton.width) / 2,
                this.fullSizeY + (this._desktop.height - this._removeButton.height) / 2);
            this._removeButton.set_opacity(0);
            Tweener.addTween(this._removeButton,
                             { x: this.gridX + (this._desktop.width * this.scale - this._removeButton.width) / 2,
                               y: this.gridY + (this._desktop.height * this.scale - this._removeButton.height) / 2,
                               opacity: 255,
                               time: Overlay.ANIMATION_TIME,
                               transition: "easeOutQuad"
                             });
        }
        
        this._visible = true;
    },

    // Animates the return from overlay mode
    zoomFromOverlay : function() {
        for (let i = 0; i < this._windows.length; i++) {
            let window = this._windows[i];
            if (window.cloneTitle)
                window.cloneTitle.hide();
            Tweener.addTween(window,
                             { x: this.fullSizeX + window.origX,
                               y: this.fullSizeY + window.origY,
                               scale_x: 1.0,
                               scale_y: 1.0,
                               time: Overlay.ANIMATION_TIME,
                               opacity: 255,
                               transition: "easeOutQuad"
                             });
        }

        if (this._removeButton) {
            Tweener.addTween(this._removeButton,
                             { x: this.fullSizeX + (this._desktop.width - this._removeButton.width) / 2,
                               y: this.fullSizeY + (this._desktop.height - this._removeButton.height) / 2,
                               opacity: 0,
                               time: Overlay.ANIMATION_TIME,
                               transition: "easeOutQuad"
                             });
        }
        
        this._visible = false;
    },

    // Animates grid shrinking/expanding when a row or column
    // of workspaces is added or removed
    resizeToGrid : function (oldScale) {
        let me = this;
        let rescale = this.scale / oldScale;

        for (let i = 0; i < this._windows.length; i++) {
            let newX = this.gridX + (this._windows[i].x - this._desktop.x) * rescale;
            let newY = this.gridY + (this._windows[i].y - this._desktop.y) * rescale;
            let newWindowScale = this._windows[i].scale_x * rescale;

            let window = this._windows[i];
            Tweener.addTween(window,
                             { x: newX,
                               y: newY,
                               scale_x: newWindowScale,
                               scale_y: newWindowScale,
                               time: Overlay.ANIMATION_TIME,
                               transition: "easeOutQuad",
                               onComplete: function () {
                                   me._adjustCloneTitle(window);
                               }
                             });

        }

        if (this._removeButton) {
            // This gets layered on top of any already-running fade-out
            // animation from setRemovable
            Tweener.addTween(this._removeButton,
                             { x: this.gridX + (this._desktop.width * this.scale - this._removeButton.width) / 2,
                               y: this.gridY + (this._desktop.height * this.scale - this._removeButton.height) / 2,
                               time: Overlay.ANIMATION_TIME,
                               transition: "easeOutQuad"
                             });
        }
    },
    
    // Animates the addition of a new (empty) workspace
    slideIn : function(oldScale) {
        let global = Shell.Global.get();

        if (this.gridCol > this.gridRow) {
            this._desktop.set_position(global.screen_width, this.gridY);
            this._desktop.set_scale(oldScale, oldScale);
        } else {
            this._desktop.set_position(this.gridX, global.screen_height);
            this._desktop.set_scale(this.scale, this.scale);
        }
        Tweener.addTween(this._desktop,
                         { x: this.gridX,
                           y: this.gridY,
                           scale_x: this.scale,
                           scale_y: this.scale,
                           time: Overlay.ANIMATION_TIME,
                           transition: "easeOutQuad"
                         });

        if (this._removeButton) {
            this._removeButton.set_position(
                this._desktop.x + (this._desktop.width * oldScale - this._removeButton.width) / 2,
                this._desktop.y + (this._desktop.height * oldScale - this._removeButton.height) / 2);
            this._removeButton.set_opacity(0);
            Tweener.addTween(this._removeButton,
                             { x: this.gridX + (this._desktop.width * this.scale - this._removeButton.width) / 2,
                               y: this.gridY + (this._desktop.height * this.scale - this._removeButton.height) / 2,
                               opacity: 255,
                               time: Overlay.ANIMATION_TIME,
                               transition: "easeOutQuad"
                             });
        }

        this._visible = true;
    },
    
    // Animates the removal of a workspace
    slideOut : function(onComplete) {
        let global = Shell.Global.get();
        let destX = this._desktop.x, destY = this._desktop.y;

        if (this.gridCol > this.gridRow)
            destX = global.screen_width;
        else
            destY = global.screen_height;
        Tweener.addTween(this._desktop,
                         { x: destX,
                           y: destY,
                           scale_x: this.scale,
                           scale_y: this.scale,
                           time: Overlay.ANIMATION_TIME,
                           transition: "easeOutQuad",
                           onComplete: onComplete
                         });

        if (this._removeButton) {
            // This gets layered on top of any already-running fade-out
            // animation from setRemovable()
            Tweener.addTween(this._removeButton,
                             { x: destX + (this._desktop.width * this.scale - this._removeButton.width) / 2,
                               y: destY + (this._desktop.height * this.scale - this._removeButton.height) / 2,
                               time: Overlay.ANIMATION_TIME,
                               transition: "easeOutQuad"
                             });
        }

        this._visible = false;
    },
    
    destroy : function() {
        this.actor.destroy();
        this.actor = null;
    },

    // Tests if @win belongs to this workspaces
    _isMyWindow : function (win) {
        return win.get_workspace() == this._workspaceNum ||
            (win.get_meta_window() && win.get_meta_window().is_on_all_workspaces());
    },

    // Tests if @win should be shown in the overlay
    _isOverlayWindow : function (win) {
        let wintype = win.get_window_type();
        if (wintype == Meta.WindowType.DESKTOP || 
            wintype == Meta.WindowType.DOCK)
            return false;
        return !win.is_override_redirect();
    },

    // Create a clone of a window to use in the overlay.
    _makeClone : function(window, index) {
        let clone = new Clutter.CloneTexture({ parent_texture: window.get_texture(),
                                               reactive: true,
                                               x: window.x,
                                               y: window.y });
        clone.realWindow = window;
        clone.origX = window.x;
        clone.origY = window.y;
        clone.index = index;
        return clone;
    },

    // Create a texture for the desktop background, used in the case
    // where there is no desktop window
    _makeDesktopRectangle : function() {
        let global = Shell.Global.get();

        // In the case when we have a desktop window from the file
        // manager, its height is full-screen, i.e. it includes the
        // height of the panel, so we should not subtract the height
        // of the panel from global.screen_height here either to have
        // them show up identically.
        let desktop = new Clutter.Rectangle({ color: global.stage.color,
                                              reactive: true,
                                              x: 0,
                                              y: 0,
                                              width: global.screen_width,
                                              height: global.screen_height });
        desktop.origX = desktop.origY = 0;
        return desktop;
    },

    _computeWindowPosition : function(index) {
        // ignore this._windows[0], which is the desktop
        let windowIndex = index - 1;
        let numberOfWindows = this._windows.length - 1;

        if (numberOfWindows in POSITIONS)
            return POSITIONS[numberOfWindows][windowIndex];

        // If we don't have a predefined scheme for this window count,
        // overlap the windows along the diagonal of the workspace
        // (improve this!)
        let fraction = Math.sqrt(1/numberOfWindows);

        // The top window goes at the lower right - this is different from the
        // fixed position schemes where the windows are in "reading order"
        // and the top window goes at the upper left.
        let pos = (numberOfWindows - windowIndex - 1) / (numberOfWindows - 1);
        let xCenter = (fraction / 2) + (1 - fraction) * pos;
        let yCenter = xCenter;

        return [xCenter, yCenter, fraction];
    },
    
    _cloneEnter: function (clone, event) {
        if (!clone.cloneTitle)
            this._createCloneTitle(clone);
    	clone.cloneTitle.show();            
        this._adjustCloneTitle(clone)
    	if (!this._overlappedMode)
    	    return;
    	if (clone.index != this._windows.length-1) {
    	    clone.raise_top();
    	    clone.cloneTitle.raise(clone);
    	}
    },
    
    _cloneLeave: function (clone, event) {
        clone.cloneTitle.hide();
    	if (!this._overlappedMode)
    	    return;    	
    	if (clone.index != this._windows.length-1) {
    	    clone.lower(this._windows[clone.index+1]);
    	    clone.cloneTitle.raise(clone);    	    
    	}
    },

    _createCloneTitle : function (clone) {
        let me = this;
        let window = clone.realWindow;
        
        let box = new Big.Box({background_color : WINDOWCLONE_BG_COLOR,
                               y_align: Big.BoxAlignment.CENTER,
                               corner_radius: 5,
                               padding: 4,
                               spacing: 4,
                               orientation: Big.BoxOrientation.HORIZONTAL});        
        
        let icon = window.meta_window.mini_icon;
        let iconTexture = new Clutter.Texture({ x: clone.x,
                                                y: clone.y + clone.height - 16,
                                                width: 16, height: 16, keep_aspect_ratio: true});
        Shell.clutter_texture_set_from_pixbuf(iconTexture, icon);
        box.append(iconTexture, Big.BoxPackFlags.NONE);
        
        let title = new Clutter.Label({color: WINDOWCLONE_TITLE_COLOR,
                                       font_name: "Sans 12",
                                       text: window.meta_window.title,
                                       ellipsize: Pango.EllipsizeMode.END});
        box.append(title, Big.BoxPackFlags.EXPAND);                                       
        // Get and cache the expected width (just the icon), with spacing, plus title
        box.fullWidth = box.width;
        box.hide(); // Hidden by default, show on mouseover
        clone.cloneTitle = box;        
        
        let parent = clone.get_parent();        
        parent.add_actor(box);
    },

    _adjustCloneTitle : function (clone) {
        let transformed = clone.get_transformed_size();
        let title = clone.cloneTitle;
        if (!title)
            return;    
        title.width = Math.min(title.fullWidth, transformed[0]);
        let xoff = (transformed[0] - title.width)/2;
        title.set_position(clone.x+xoff, clone.y);
    },

    _activateWindow : function(w, time) {
        let global = Shell.Global.get();
        let activeWorkspace = global.screen.get_active_workspace_index();
        let windowWorkspace = w.get_workspace();

        if (windowWorkspace != activeWorkspace) {
            let workspace = global.screen.get_workspace_by_index(windowWorkspace);
            workspace.activate_with_focus(w.get_meta_window(), time);
        } else
            w.get_meta_window().activate(time);
        Main.hide_overlay();
    },

    _removeSelf : function(actor, event) {
        let global = Shell.Global.get();
        let screen = global.screen;
        let workspace = screen.get_workspace_by_index(this._workspaceNum);

        screen.remove_workspace(workspace, event.get_time());
    }
};

function Workspaces() {
    this._init();
}

Workspaces.prototype = {
    _init : function() {
        let me = this;
        let global = Shell.Global.get();

        this.actor = new Clutter.Group();

        let screenWidth = global.screen_width;
        let screenHeight = global.screen_height;

        this._width = screenWidth * Overlay.WORKSPACE_GRID_SCALE;
        this._height = screenHeight * Overlay.WORKSPACE_GRID_SCALE;
        this._x = screenWidth - this._width - Overlay.WORKSPACE_GRID_PADDING;
        this._y = Panel.PANEL_HEIGHT + (screenHeight - this._height - Panel.PANEL_HEIGHT) / 2;

        this._workspaces = [];
        
        let activeWorkspaceIndex = global.screen.get_active_workspace_index();
        let activeWorkspace;

        // Create and position workspace objects
        for (let w = 0; w < global.screen.n_workspaces; w++) {
            this._workspaces[w] = new Workspace(w);
            if (w == activeWorkspaceIndex)
                activeWorkspace = this._workspaces[w];
            this.actor.add_actor(this._workspaces[w].actor);
        }
        activeWorkspace.actor.raise_top();
        this._positionWorkspaces(global, activeWorkspace);

        // Create a backdrop rectangle, so that you don't see the
        // other parts of the overlay (eg, sidebar) through the gaps
        // between the workspaces when they're zooming in/out
        this._backdrop = new Clutter.Rectangle({ color: Overlay.OVERLAY_BACKGROUND_COLOR,
                                                 x: this._backdropX,
                                                 y: this._backdropY,
                                                 width: this._backdropWidth,
                                                 height: this._backdropHeight
                                               });
        this.actor.add_actor(this._backdrop);
        this._backdrop.lower_bottom();
        Tweener.addTween(this._backdrop,
                         { x: this._x,
                           y: this._y,
                           width: this._width,
                           height: this._height,
                           time: Overlay.ANIMATION_TIME,
                           transition: "easeOutQuad"
                         });

        // Create (+) and (-) buttons
        let bottomHeight = screenHeight - this._height - this._y;
        this._buttonSize = Math.floor(bottomHeight * 3/5);
        let plusX = this._x + this._width - this._buttonSize;
        let plusY = screenHeight - Math.floor(bottomHeight * 4/5);

        let plus = new Clutter.Texture({ x: plusX,
                                         y: plusY,
                                         width: this._buttonSize,
                                         height: this._buttonSize,
                                         reactive: true
                                       });
        plus.set_from_file(global.imagedir + "add-workspace.svg");
        plus.connect('button-press-event', this._addWorkspace);
        this.actor.add_actor(plus);
        plus.lower_bottom();

        let lastWorkspace = this._workspaces[this._workspaces.length - 1];
        if (lastWorkspace.isEmpty())
            lastWorkspace.setRemovable(true, this._buttonSize);

        // Position/scale the desktop windows and their children
        for (let w = 0; w < this._workspaces.length; w++)
            this._workspaces[w].zoomToOverlay();

        // Track changes to the number of workspaces
        this._nWorkspacesNotifyId =
            global.screen.connect('notify::n-workspaces',
                                  function() {
                                      me._workspacesChanged();
                                  });
    },

    hide : function() {
        let global = Shell.Global.get();
        let activeWorkspaceIndex = global.screen.get_active_workspace_index();
        let activeWorkspace = this._workspaces[activeWorkspaceIndex];

        this._positionWorkspaces(global, activeWorkspace);
        activeWorkspace.actor.raise_top();

        for (let w = 0; w < this._workspaces.length; w++)
            this._workspaces[w].zoomFromOverlay();

        Tweener.addTween(this._backdrop,
                         { x: this._backdropX,
                           y: this._backdropY,
                           width: this._backdropWidth,
                           height: this._backdropHeight,
                           time: Overlay.ANIMATION_TIME,
                           transition: "easeOutQuad"
                         });
    },

    destroy : function() {
        let global = Shell.Global.get();

        for (let w = 0; w < this._workspaces.length; w++)
            this._workspaces[w].destroy();
        this._workspaces = [];

        this.actor.destroy();
        this.actor = null;
        this._backdrop = null;

        global.screen.disconnect(this._nWorkspacesNotifyId);
    },

    // Assign grid positions to workspaces. We can't just do a simple
    // row-major or column-major numbering, because we don't want the
    // existing workspaces to get rearranged when we add a row or
    // column. So we alternate between adding to rows and adding to
    // columns. (So, eg, when going from a 2x2 grid of 4 workspaces to
    // a 3x2 grid of 5 workspaces, the 4 existing workspaces stay
    // where they are, and the 5th one is added to the end of the
    // first row.)
    //
    // FIXME: need to make the metacity internal layout agree with this!
    _positionWorkspaces : function(global, activeWorkspace) {
        if (!activeWorkspace) {
            let activeWorkspaceIndex = global.screen.get_active_workspace_index();
            activeWorkspace = this._workspaces[activeWorkspaceIndex];
        }

        let gridWidth = Math.ceil(Math.sqrt(this._workspaces.length));
        let gridHeight = Math.ceil(this._workspaces.length / gridWidth);

        let wsWidth = (this._width - (gridWidth - 1) * GRID_SPACING) / gridWidth;
        let wsHeight = (this._height - (gridHeight - 1) * GRID_SPACING) / gridHeight;
        let scale = wsWidth / global.screen_width;

        let span = 1, n = 0, row = 0, col = 0, horiz = true;

        for (let w = 0; w < this._workspaces.length; w++) {
            let workspace = this._workspaces[w];

            workspace.gridRow = row;
            workspace.gridCol = col;

            workspace.gridX = this._x + workspace.gridCol * (wsWidth + GRID_SPACING);
            workspace.gridY = this._y + workspace.gridRow * (wsHeight + GRID_SPACING);
            workspace.scale = scale;

            if (horiz) {
                col++;
                if (col == span) {
                    row = 0;
                    horiz = false;
                }
            } else {
                row++;
                if (row == span) {
                    col = 0;
                    horiz = true;
                    span++;
                }
            }
        }

        // Now figure out their full-size coordinates
        for (let w = 0; w < this._workspaces.length; w++) {
            let workspace = this._workspaces[w];

            workspace.fullSizeX = (workspace.gridCol - activeWorkspace.gridCol) * (global.screen_width + GRID_SPACING);
            workspace.fullSizeY = (workspace.gridRow - activeWorkspace.gridRow) * (global.screen_height + GRID_SPACING);
        }

        // And the backdrop
        this._backdropX = this._workspaces[0].fullSizeX;
        this._backdropY = this._workspaces[0].fullSizeY;
        this._backdropWidth = gridWidth * (global.screen_width + GRID_SPACING) - GRID_SPACING;
        this._backdropHeight = gridHeight * (global.screen_height + GRID_SPACING) - GRID_SPACING;
    },

    _workspacesChanged : function() {
        let global = Shell.Global.get();

        let oldNumWorkspaces = this._workspaces.length;
        let newNumWorkspaces = global.screen.n_workspaces;

        if (oldNumWorkspaces == newNumWorkspaces)
            return;

        let oldScale = this._workspaces[0].scale;
        let oldGridWidth = Math.ceil(Math.sqrt(oldNumWorkspaces));
        let oldGridHeight = Math.ceil(oldNumWorkspaces / oldGridWidth);
        let lostWorkspaces = [];

        // The old last workspace is no longer removable.
        this._workspaces[oldNumWorkspaces - 1].setRemovable(false);

        if (newNumWorkspaces > oldNumWorkspaces) {
            // Create new workspace groups
            for (let w = oldNumWorkspaces; w < newNumWorkspaces; w++) {
                this._workspaces[w] = new Workspace(w);
                this.actor.add_actor(this._workspaces[w].actor);
            }

        } else {
            // Truncate the list of workspaces
            // FIXME: assumes that the workspaces are being removed from
            // the end of the list, not the start/middle
            lostWorkspaces = this._workspaces.splice(newNumWorkspaces);
        }

        // The new last workspace may be removable
        let newLastWorkspace = this._workspaces[this._workspaces.length - 1];
        if (newLastWorkspace.isEmpty())
            newLastWorkspace.setRemovable(true, this._buttonSize);

        // Figure out the new layout
        this._positionWorkspaces(global);
        let newScale = this._workspaces[0].scale;
        let newGridWidth = Math.ceil(Math.sqrt(newNumWorkspaces));
        let newGridHeight = Math.ceil(newNumWorkspaces / newGridWidth);

        if (newGridWidth != oldGridWidth || newGridHeight != oldGridHeight) {
            // We need to resize/move the existing workspaces/windows
            let existingWorkspaces = Math.min(oldNumWorkspaces, newNumWorkspaces);
            for (let w = 0; w < existingWorkspaces; w++)
                this._workspaces[w].resizeToGrid(oldScale);
        }

        if (newNumWorkspaces > oldNumWorkspaces) {
            // Slide new workspaces in from offscreen
            for (let w = oldNumWorkspaces; w < newNumWorkspaces; w++)
                this._workspaces[w].slideIn(oldScale);
        } else {
            // Slide old workspaces out
            for (let w = 0; w < lostWorkspaces.length; w++) {
                let workspace = lostWorkspaces[w];
                workspace.slideOut(function () { workspace.destroy(); });
            }

            // FIXME: deal with windows on the lost workspaces
        }
    },

    _addWorkspace : function(actor, event) {
        let global = Shell.Global.get();

        global.screen.append_new_workspace(false, event.get_time());
    }
};
