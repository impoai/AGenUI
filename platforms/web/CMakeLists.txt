cmake_minimum_required(VERSION 3.24)
project(agenui_web LANGUAGES C CXX)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Use emcmake cmake -S platforms/web -B platforms/web/build")
endif()
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
get_filename_component(REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
include(FetchContent)
# The same Yoga release used by the native platforms, pinned to its commit.
FetchContent_Declare(yoga
  GIT_REPOSITORY https://github.com/facebook/yoga.git
  GIT_TAG 83a58bb9d6c14f8ea75c45b621a8700f895e24c1
  SOURCE_SUBDIR sources-only)
FetchContent_MakeAvailable(yoga)
file(GLOB_RECURSE YOGA_SOURCES CONFIGURE_DEPENDS "${yoga_SOURCE_DIR}/yoga/*.cpp")
add_library(web_yoga STATIC ${YOGA_SOURCES})
target_include_directories(web_yoga PUBLIC "${yoga_SOURCE_DIR}")
target_compile_options(web_yoga PRIVATE -fexceptions -Wno-error)

file(GLOB_RECURSE CORE_SOURCES CONFIGURE_DEPENDS "${REPO_ROOT}/core/src/*.cpp")
list(FILTER CORE_SOURCES EXCLUDE REGEX "/jni/|agenui_platform_invoker_.*")
list(FILTER CORE_SOURCES EXCLUDE REGEX "/third_party/.*Html\\.cpp|/third_party/sax/|/third_party/ik/|/third_party/key_define\\.cpp")
# Only scheduling is platform-specific. Parsing, bindings, functions, diffs,
# themes and Yoga are compiled directly from the shared core, without a fork.
list(FILTER CORE_SOURCES EXCLUDE REGEX "agenui_(message_thread|thread_manager)\\.cpp$")
add_executable(agenui ${CORE_SOURCES} native/event_loop.cpp native/bridge.cpp)
target_include_directories(agenui PRIVATE
  "${REPO_ROOT}/core/include" "${REPO_ROOT}/core/src"
  "${REPO_ROOT}/core/src/third_party" "${REPO_ROOT}/core/src/third_party/nlohmann")
target_compile_options(agenui PRIVATE -fexceptions -Wno-error)
target_link_libraries(agenui PRIVATE web_yoga)
target_link_options(agenui PRIVATE
  --bind --no-entry -fexceptions
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createAGenUIModule
  "-sINCOMING_MODULE_JS_API=['locateFile','wasmBinary','print','printErr']"
  -sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456
  -sSTACK_SIZE=1048576 -sFILESYSTEM=1 -sASSERTIONS=1)
set_target_properties(agenui PROPERTIES SUFFIX ".mjs")
