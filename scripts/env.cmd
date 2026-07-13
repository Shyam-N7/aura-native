@echo off
rem Per-session toolchain env — everything on D:, never trust machine-level ANDROID_HOME
rem (the global one is stale and points at a nonexistent C: path).
set "JAVA_HOME=D:\Android\jdk-17"
set "ANDROID_HOME=D:\Android\sdk"
set "ANDROID_SDK_ROOT=D:\Android\sdk"
set "ANDROID_USER_HOME=D:\Android\.android"
set "GRADLE_USER_HOME=D:\Android\gradle-home"
set "NPM_CONFIG_CACHE=D:\Android\npm-cache"
set "TMP=D:\Android\tmp"
set "TEMP=D:\Android\tmp"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
