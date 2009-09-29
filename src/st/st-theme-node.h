/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
#ifndef __ST_THEME_NODE_H__
#define __ST_THEME_NODE_H__

#include <clutter/clutter.h>
#include "st-theme-image.h"

G_BEGIN_DECLS

typedef struct _StTheme          StTheme;
typedef struct _StThemeContext   StThemeContext;

typedef struct _StThemeNode      StThemeNode;
typedef struct _StThemeNodeClass StThemeNodeClass;

#define ST_TYPE_THEME_NODE              (st_theme_node_get_type ())
#define ST_THEME_NODE(object)           (G_TYPE_CHECK_INSTANCE_CAST ((object), ST_TYPE_THEME_NODE, StThemeNode))
#define ST_THEME_NODE_CLASS(klass)      (G_TYPE_CHECK_CLASS_CAST ((klass),     ST_TYPE_THEME_NODE, StThemeNodeClass))
#define ST_IS_THEME_NODE(object)        (G_TYPE_CHECK_INSTANCE_TYPE ((object), ST_TYPE_THEME_NODE))
#define ST_IS_THEME_NODE_CLASS(klass)   (G_TYPE_CHECK_CLASS_TYPE ((klass),     ST_TYPE_THEME_NODE))
#define ST_THEME_NODE_GET_CLASS(obj)    (G_TYPE_INSTANCE_GET_CLASS ((obj),     ST_TYPE_THEME_NODE, StThemeNodeClass))

typedef enum {
    ST_SIDE_LEFT,
    ST_SIDE_RIGHT,
    ST_SIDE_TOP,
    ST_SIDE_BOTTOM
} StSide;

/* These are the CSS values; that doesn't mean we have to implement blink... */
typedef enum {
    ST_TEXT_DECORATION_UNDERLINE    = 1 << 0,
    ST_TEXT_DECORATION_OVERLINE     = 1 << 1,
    ST_TEXT_DECORATION_LINE_THROUGH = 1 << 2,
    ST_TEXT_DECORATION_BLINK        = 1 << 3
} StTextDecoration;

GType st_theme_node_get_type (void) G_GNUC_CONST;

/* An element_type of G_TYPE_NONE means this style was created for the stage
 * actor and matches a selector element name of 'stage'
 */
StThemeNode *st_theme_node_new (StThemeContext *context,
                                StThemeNode    *parent_node,   /* can be null */
                                StTheme        *theme,         /* can be null */
                                GType           element_type,
                                const char     *element_id,
                                const char     *element_class,
                                const char     *pseudo_class);

StThemeNode *st_theme_node_get_parent (StThemeNode *node);

StTheme *st_theme_node_get_theme (StThemeNode *node);

GType       st_theme_node_get_element_type  (StThemeNode *node);
const char *st_theme_node_get_element_id    (StThemeNode *node);
const char *st_theme_node_get_element_class (StThemeNode *node);
const char *st_theme_node_get_pseudo_class  (StThemeNode *node);

/* Generic getters ... these are not cached so are less efficient. The other
 * reason for adding the more specific version is that we can handle the
 * details of the actual CSS rules, which can be complicated, especially
 * for fonts
 */
gboolean st_theme_node_get_color  (StThemeNode  *node,
                                   const char   *property_name,
                                   gboolean      inherit,
                                   ClutterColor *color);

gboolean st_theme_node_get_double (StThemeNode  *node,
                                   const char   *property_name,
                                   gboolean      inherit,
                                   double       *value);

/* The length here is already resolved to pixels
 */
gboolean st_theme_node_get_length (StThemeNode *node,
                                   const char  *property_name,
                                   gboolean     inherit,
                                   gdouble     *length);

/* Specific getters for particular properties: cached
 */
void st_theme_node_get_background_color (StThemeNode  *node,
                                         ClutterColor *color);
void st_theme_node_get_foreground_color (StThemeNode  *node,
                                         ClutterColor *color);

const char *st_theme_node_get_background_image (StThemeNode *node);

double st_theme_node_get_border_width (StThemeNode  *node,
                                       StSide        side);
void   st_theme_node_get_border_color (StThemeNode  *node,
                                       StSide        side,
                                       ClutterColor *color);
double st_theme_node_get_padding      (StThemeNode  *node,
                                       StSide        side);

StTextDecoration st_theme_node_get_text_decoration (StThemeNode *node);

/* Font rule processing is pretty complicated, so we just hardcode it
 * under the standard font/font-family/font-size/etc names. This means
 * you can't have multiple separate styled fonts for a single item,
 * but that should be OK.
 */
const PangoFontDescription *st_theme_node_get_font (StThemeNode *node);

/* This is the getter for -st-background-image, which is different from
 * background-image in having provisions for unscaled borders.
 */
StThemeImage *st_theme_node_get_background_theme_image (StThemeNode *node);

G_END_DECLS

#endif /* __ST_THEME_NODE_H__ */
