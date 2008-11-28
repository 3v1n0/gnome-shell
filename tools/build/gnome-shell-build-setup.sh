#!/bin/sh
#
# Script that sets up jhbuild to build gnome-shell. Run this to
# checkout jhbuild and the required configuration. 
#
# Copyright (C) 2008, Red Hat, Inc.
#
# Some ideas and code taken from gtk-osx-build
#
# Copyright (C) 2006, 2007, 2008 Imendio AB
#
SOURCE=$HOME/Source
BASEURL=http://svn.gnome.org/svn/gnome-shell/trunk/tools/build

if [ -d $SOURCE ] ; then : ; else
    mkdir $SOURCE
    echo "Created $SOURCE"
fi

echo -n "Checking out jhbuild into $SOURCE/jhbuild ... "
cd $SOURCE
svn co http://svn.gnome.org/svn/jhbuild/trunk jhbuild > /dev/null
echo "done"

echo "Installing jhbuild..."
(cd $SOURCE/jhbuild && make -f Makefile.plain DISABLE_GETTEXT=1 install >/dev/null)

if [ -e $HOME/.jhbuildrc ] ; then
    if grep JHBUILDRC_GNOME_SHELL $HOME/.jhbuildrc > /dev/null ; then : ; else
	mv $HOME/.jhbuildrc $HOME/.jhbuildrc.bak
	echo "Saved ~/.jhbuildrc as ~/.jhbuildrc.bak"
    fi
fi

echo -n "Writing ~/.jhbuildrc ... "
curl -s -o $HOME/.jhbuildrc $BASEURL/jhbuildrc-gnome-shell
echo "done"

if [ ! -f $HOME/.jhbuildrc-custom ]; then
    echo -n "Writing example ~/.jhbuildrc-custom ... "
    curl -s -o $HOME/.jhbuildrc-custom $BASEURL/jhbuildrc-custom-example
    echo "done"
fi

if test "x`echo $PATH | grep $HOME/bin`" = x; then
    echo "PATH does not contain $HOME/bin, it is recommended that you add that."
    echo
fi

system=`lsb_release -is`
if test x$system = xUbuntu -o x$system = xDebian ; then
  reqd=""
  for pkg in libgconf2-dev git-core gtk-doc-tools libgl1-mesa-dev \
    mesa-common-dev libffi-dev libgtk2.0-dev flex build-essential \
    curl xulrunner-1.9-dev; do
      if dpkg --status $pkg > /dev/null 2>&1; then : ; else
        reqd="$pkg $reqd"
      fi
  done
  if test ! x$reqd = x; then
    echo "Please run, as root, 'apt-get install $reqd' before building gnome-shell."
    echo
  fi
fi

+
 echo "Done."

echo "Done."

