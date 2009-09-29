/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;

const UI = imports.testcommon.ui;

UI.init();
let stage = Clutter.Stage.get_default();

let vbox = new St.BoxLayout({ vertical: true,
                              width: stage.width,
                              height: stage.height });
stage.add_actor(vbox);

let hbox = new St.BoxLayout({ spacing: 12 });
vbox.add(hbox);

let text = new St.Label({ text: "Styled Text" });
vbox.add (text);

let size = 24;
function update_size() {
    text.style = 'font-size: ' + size + 'pt';
}
update_size();

let button = new St.Button ({ label: 'Smaller',
                              style: 'padding: 4px; background: #eeddcc' });
hbox.add (button);
button.connect('clicked', function() {
                   size /= 1.2;
                   update_size ();
               });

let button = new St.Button ({ label: 'Bigger',
                              style: 'padding: 4px; background: #eeddcc' });
hbox.add (button);
button.connect('clicked', function() {
                   size *= 1.2;
                   update_size ();
               });

stage.show();
Clutter.main();
stage.destroy();

