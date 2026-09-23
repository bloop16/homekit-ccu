#!/bin/tclsh

# The CCU's add-on page calls ?cmd=check_version&version=<installed> and shows the plain
# text answer as the available version; ?cmd=download opens the download page.
# The latest GitHub release (prereleases excluded) is the source, its tag is v<version>.
set version_url "https://api.github.com/repos/bloop16/homekit-ccu/releases/latest"
set package_url "https://github.com/bloop16/homekit-ccu/releases/latest"

catch {
  set input $env(QUERY_STRING)
  set pairs [split $input &]
  foreach pair $pairs {
    if {0 != [regexp "^(\[^=]*)=(.*)$" $pair dummy varname val]} {
      set $varname $val
    }
  }
}

if { [info exists cmd ] && $cmd == "download"} {
  puts -nonewline "Content-Type: text/html; charset=utf-8\r\n\r\n"
  puts -nonewline "<html><head><meta http-equiv='refresh' content='0; url=$package_url' /></head><body></body></html>"
} else {
  puts -nonewline "Content-Type: text/plain; charset=utf-8\r\n\r\n"
  catch {
    set json [ exec /usr/bin/wget -qO- --no-check-certificate $version_url ]
    regexp {"tag_name"\s*:\s*"v([^"]+)"} $json -> newversion
  }
  if { [info exists newversion] } {
    puts $newversion
  } else {
    puts "n/a"
  }
}
