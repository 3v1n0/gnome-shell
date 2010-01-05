/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
#ifndef __SHELL_APP_SYSTEM_H__
#define __SHELL_APP_SYSTEM_H__

#include <gio/gio.h>
#include <clutter/clutter.h>

#include "shell-app.h"
#include "window.h"

#define SHELL_TYPE_APP_SYSTEM                 (shell_app_system_get_type ())
#define SHELL_APP_SYSTEM(obj)                 (G_TYPE_CHECK_INSTANCE_CAST ((obj), SHELL_TYPE_APP_SYSTEM, ShellAppSystem))
#define SHELL_APP_SYSTEM_CLASS(klass)         (G_TYPE_CHECK_CLASS_CAST ((klass), SHELL_TYPE_APP_SYSTEM, ShellAppSystemClass))
#define SHELL_IS_APP_SYSTEM(obj)              (G_TYPE_CHECK_INSTANCE_TYPE ((obj), SHELL_TYPE_APP_SYSTEM))
#define SHELL_IS_APP_SYSTEM_CLASS(klass)      (G_TYPE_CHECK_CLASS_TYPE ((klass), SHELL_TYPE_APP_SYSTEM))
#define SHELL_APP_SYSTEM_GET_CLASS(obj)       (G_TYPE_INSTANCE_GET_CLASS ((obj), SHELL_TYPE_APP_SYSTEM, ShellAppSystemClass))

typedef struct _ShellAppSystem ShellAppSystem;
typedef struct _ShellAppSystemClass ShellAppSystemClass;
typedef struct _ShellAppSystemPrivate ShellAppSystemPrivate;

struct _ShellAppSystem
{
  GObject parent;

  ShellAppSystemPrivate *priv;
};

struct _ShellAppSystemClass
{
  GObjectClass parent_class;

  void (*installed_changed)(ShellAppSystem *appsys, gpointer user_data);
  void (*favorites_changed)(ShellAppSystem *appsys, gpointer user_data);
};

GType shell_app_system_get_type (void) G_GNUC_CONST;
ShellAppSystem* shell_app_system_get_default(void);

typedef struct _ShellAppInfo ShellAppInfo;

#define SHELL_TYPE_APP_INFO (shell_app_info_get_type ())
GType shell_app_info_get_type (void);

ShellAppInfo* shell_app_info_ref (ShellAppInfo *info);
void shell_app_info_unref (ShellAppInfo *info);

const char *shell_app_info_get_id (ShellAppInfo *info);
char *shell_app_info_get_name (ShellAppInfo *info);
char *shell_app_info_get_description (ShellAppInfo *info);
char *shell_app_info_get_executable (ShellAppInfo *info);
char *shell_app_info_get_desktop_file_path (ShellAppInfo *info);
ClutterActor *shell_app_info_create_icon_texture (ShellAppInfo *info, float size);
GSList *shell_app_info_get_categories (ShellAppInfo *info);
gboolean shell_app_info_get_is_nodisplay (ShellAppInfo *info);
gboolean shell_app_info_is_transient (ShellAppInfo *info);
gboolean shell_app_info_launch_full (ShellAppInfo *info,
                            guint         timestamp,
                            GList        *uris,
                            int           workspace,
                            char        **startup_id,
                            GError      **error);
gboolean shell_app_info_launch (ShellAppInfo *info,
                                GError      **error);

ShellAppInfo *shell_app_system_load_from_desktop_file (ShellAppSystem *system, const char *filename, GError **error);

ShellApp *shell_app_system_get_app (ShellAppSystem *system, const char *id);

void _shell_app_system_register_app (ShellAppSystem *self, ShellApp *app);

ShellApp *shell_app_system_lookup_heuristic_basename (ShellAppSystem *system, const char *id);

ShellAppInfo *shell_app_system_create_from_window (ShellAppSystem *system, MetaWindow *window);

GSList *shell_app_system_get_flattened_apps (ShellAppSystem *system);

GSList *shell_app_system_get_all_settings (ShellAppSystem *system);

GSList *shell_app_system_initial_search (ShellAppSystem *system,
                                         gboolean        prefs,
                                         GSList         *terms);

GSList *shell_app_system_subsearch (ShellAppSystem   *system,
                                    gboolean          prefs,
                                    GSList           *previous_results,
                                    GSList           *terms);

#endif /* __SHELL_APP_SYSTEM_H__ */
