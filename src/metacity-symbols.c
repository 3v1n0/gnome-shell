/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */

#include <mutter-plugin.h>

ClutterActor *
mutter_plugin_get_overlay_group (MutterPlugin *plugin)
{
  return NULL;
}

ClutterActor *
mutter_plugin_get_stage (MutterPlugin *plugin)
{
  return NULL;
}

GList *
mutter_plugin_get_windows (MutterPlugin *plugin)
{
}

void
mutter_plugin_query_screen_size (MutterPlugin *plugin,
                                 int          *width,
                                 int          *height)
{
}

void
mutter_plugin_set_stage_input_area (MutterPlugin *plugin,
                                    gint x, gint y, gint width, gint height)
{
}

MetaScreen *
mutter_plugin_get_screen (MutterPlugin *plugin)
{
}

Display *
meta_display_get_xdisplay (MetaDisplay *display)
{
}

MetaDisplay *
meta_screen_get_display (MetaScreen *display)
{
}

Window
meta_screen_get_xroot (MetaScreen *display)
{
}
