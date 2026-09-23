#!/bin/tclsh

# The CCU's add-on page calls ?cmd=check_version&version=<installed> and shows the plain
# text answer as the available version; ?cmd=download opens the download page.
# The latest GitHub release (prereleases excluded) is the source, its tag is v<version>.
set version_url "https://api.github.com/repos/bloop16/homekit-ccu/releases/latest"
set package_url "https://github.com/bloop16/homekit-ccu/releases/latest"

# Only cmd is read; other parameters (version, ...) are ignored so a query string can never
# change the URLs above or any other variable of this script.
set cmd ""
catch {
  regexp {(?:^|&)cmd=([^&]*)} $env(QUERY_STRING) -> cmd
}

if { $cmd == "download" } {
  puts -nonewline "Content-Type: text/html; charset=utf-8\r\n\r\n"
  puts -nonewline "<html><head><meta http-equiv='refresh' content='0; url=$package_url' /></head><body></body></html>"
} else {
  puts -nonewline "Content-Type: text/plain; charset=utf-8\r\n\r\n"
  catch {
    # the answer is shown as HTML in the add-on list and wget skips certificate checks,
    # so only a version-shaped tag is passed on
    set json [ exec /usr/bin/wget -qO- --no-check-certificate $version_url ]
    regexp {"tag_name"\s*:\s*"v([0-9][0-9A-Za-z.+-]*)"} $json -> newversion
  }
  if { [info exists newversion] } {
    puts $newversion
  } else {
    puts "n/a"
  }
}
