/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */

#include "shell-panel-window.h"
#include <libwnck/libwnck.h>
#include <stdlib.h>
#include <string.h>
#include <dbus/dbus-glib.h>

static void
on_name_owner_changed (DBusGProxy *proxy,
    const char *name,
    const char *prev_owner,
    const char *new_owner,
    gpointer   user_data)
{
  if (strcmp (name, "org.gnome.Shell") == 0 && new_owner[0] == '\0')
    exit (0);
}

static void
monitor_main_shell (const char *shell_name)
{
  DBusGConnection *session;
  DBusGProxy *driver;
  GError *error = NULL;
  gboolean have_shell;
  
  session = dbus_g_bus_get (DBUS_BUS_SESSION, NULL);
  
  driver = dbus_g_proxy_new_for_name (session,
                                      DBUS_SERVICE_DBUS,
                                      DBUS_PATH_DBUS,
                                      DBUS_INTERFACE_DBUS);
  
  if (!dbus_g_proxy_call (driver, "NameHasOwner", &error, G_TYPE_STRING,
                          shell_name, G_TYPE_INVALID, G_TYPE_BOOLEAN,
                          &have_shell, G_TYPE_INVALID)) 
    {
      /* Shouldn't happen */
      exit (1);
    }
  if (!have_shell)
    {
      /* Shell doesn't exist; either crashed or was restarted.  Just abort. */      
      exit (0);
    }

  dbus_g_proxy_add_signal (driver,
                           "NameOwnerChanged",
                           G_TYPE_STRING,
                           G_TYPE_STRING,
                           G_TYPE_STRING,
                           G_TYPE_INVALID);
  
  dbus_g_proxy_connect_signal (driver,
                               "NameOwnerChanged", 
                               G_CALLBACK (on_name_owner_changed),
                               NULL,
                               NULL);  
}

int 
main (int argc, char **argv)
{
  ShellPanelWindow *panel;
  WnckScreen *screen;
  WnckTasklist *tasks;
  
  gtk_init (&argc, &argv);
  
  if (argc != 2) {
    g_printerr ("Usage: gnomeshell-taskpanel [PARENT_DBUS_SERVICE]\n");
    exit (1);
  }
  
  monitor_main_shell (argv[1]);
  
  panel = shell_panel_window_new ();
  
  screen = wnck_screen_get_default();
  tasks = WNCK_TASKLIST (wnck_tasklist_new (screen));
  
  gtk_container_add (GTK_CONTAINER (panel), GTK_WIDGET (tasks));
  
  gtk_widget_show_all (GTK_WIDGET (panel));
  
  gtk_main ();
  
  exit (0);
}