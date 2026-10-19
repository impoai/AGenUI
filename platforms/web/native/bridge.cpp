// Copyright 2026 Impo. SPDX-License-Identifier: Apache-2.0
#include <emscripten/bind.h>
#include <cmath>
#include "agenui_engine_entry.h"
#include "agenui_surface_manager_interface.h"
#include "agenui_surface_size_provider.h"
#include "agenui_message_listener.h"
#include "agenui_logger_interface.h"
#include "json.hpp"

using emscripten::val;
using nlohmann::json;
using namespace agenui;
namespace {
class QuietLogger final : public IRuntimeLogger {
 public:
  LogLevel getMinLevel() const override { return LOG_LEVEL_FATAL; }
  void log(LogLevel, const char*, const char*, int, const char*, ...) override {}
};
QuietLogger logger;
class WebMeasurement final : public IMeasurement {
  std::string type_;
  val callback_;
 public:
  WebMeasurement(std::string type, val callback) : type_(std::move(type)), callback_(callback) {}
  MeasureResult measure(const std::string& properties, const MeasureModes& modes) override {
    auto result = callback_(type_, properties, modes.width.maxValue, modes.width.mode,
                            modes.height.maxValue, modes.height.mode);
    float width = result["width"].as<float>();
    float height = result["height"].as<float>();
    // A broken host measurement must not feed NaN/Infinity into Yoga.
    return {CalcType::Sync, std::isfinite(width) ? std::max(0.0f, width) : 0.0f,
            std::isfinite(height) ? std::max(0.0f, height) : 0.0f, 0};
  }
};
void initialize() {
  auto* engine = initAGenUIEngine();
  engine->setDebug(false);
  engine->setRuntimeLogger(&logger);
}
void registerMeasurement(const std::string& type, val callback) {
  auto* measurements = getAGenUIEngine()->getMeasurementManager();
  measurements->unregisterMeasurement(type);
  measurements->registerMeasurement(type, std::make_shared<WebMeasurement>(type, callback));
}
void theme(const std::string& mode) { getAGenUIEngine()->setDayNightMode(mode); }
std::string loadTheme(const std::string& input) {
  std::string error;
  getAGenUIEngine()->loadThemeConfig(input, error);
  return error;
}
std::string loadTokens(const std::string& input) {
  std::string error;
  getAGenUIEngine()->loadDesignTokenConfig(input, error);
  return error;
}
class WebSurface final : public IAGenUIMessageListener, public ISurfaceSizeProvider {
  ISurfaceManager* manager_;
  val listener_;
  SurfaceSize size_;
  void emit(const json& message) { listener_(message.dump()); }
 public:
  WebSurface(val listener, float width, float height)
      : manager_(getAGenUIEngine()->createSurfaceManager()), listener_(listener), size_{width, height} {
    manager_->setSurfaceSizeProvider(this);
    manager_->addSurfaceEventListener(this);
  }
  ~WebSurface() override {
    manager_->removeSurfaceEventListener(this);
    manager_->setSurfaceSizeProvider(nullptr);
    getAGenUIEngine()->destroySurfaceManager(manager_);
  }
  SurfaceSize getSurfaceSize(const std::string&) override { return size_; }
  void begin() { manager_->beginTextStream(); }
  void push(const std::string& chunk) { manager_->receiveTextChunk(chunk); }
  void end() { manager_->endTextStream(); }
  void resize(const std::string& surface, float width, float height) {
    size_ = {width, height};
    manager_->onSurfaceSizeChanged({surface, width, height});
  }
  void change(const std::string& surface, const std::string& component, const std::string& values) {
    manager_->submitUIDataModel({surface, component, values});
  }
  void action(const std::string& surface, const std::string& component, const std::string& context) {
    manager_->submitUIAction({surface, component, context});
  }
  void invalidate() { manager_->invalidateFunctionCallValues(); }
  void onCreateSurface(const CreateSurfaceMessage& m) override {
    emit({{"type", "create"}, {"surfaceId", m.surfaceId}, {"catalogId", m.catalogId}});
  }
  void onDeleteSurface(const DeleteSurfaceMessage& m) override {
    emit({{"type", "delete"}, {"surfaceId", m.surfaceId}});
  }
  void onComponentsAdd(const std::string& surface, const std::vector<ComponentsAddMessage>& messages) override {
    auto items = json::array();
    for (const auto& m : messages) items.push_back({{"id", m.componentId}, {"parentId", m.parentId}, {"value", json::parse(m.component)}});
    emit({{"type", "add"}, {"surfaceId", surface}, {"items", items}});
  }
  void onComponentsUpdate(const std::string& surface, const std::vector<ComponentsUpdateMessage>& messages) override {
    auto items = json::array();
    for (const auto& m : messages) items.push_back({{"id", m.componentId}, {"value", json::parse(m.component)}});
    emit({{"type", "update"}, {"surfaceId", surface}, {"items", items}});
  }
  void onComponentsRemove(const std::string& surface, const std::vector<ComponentsRemoveMessage>& messages) override {
    auto items = json::array();
    for (const auto& m : messages) items.push_back({{"id", m.componentId}, {"parentId", m.parentId}});
    emit({{"type", "remove"}, {"surfaceId", surface}, {"items", items}});
  }
  void onActionEventRouted(const std::string& content) override { emit({{"type", "action"}, {"value", json::parse(content)}}); }
  void onError(const ErrorMessage& m) override { emit({{"type", "error"}, {"surfaceId", m.surfaceId}, {"code", m.code}, {"message", m.message}}); }
};
}  // namespace
EMSCRIPTEN_BINDINGS(agenui_web) {
  emscripten::function("initialize", &initialize);
  emscripten::function("registerMeasurement", &registerMeasurement);
  emscripten::function("setTheme", &theme);
  emscripten::function("loadTheme", &loadTheme);
  emscripten::function("loadTokens", &loadTokens);
  emscripten::function("shutdown", &destroyAGenUIEngine);
  emscripten::function("version", emscripten::optional_override([]() { return std::string(getAGenUIVersion()); }));
  emscripten::class_<WebSurface>("NativeSurface")
      .constructor<val, float, float>()
      .function("begin", &WebSurface::begin).function("push", &WebSurface::push)
      .function("end", &WebSurface::end).function("resize", &WebSurface::resize)
      .function("change", &WebSurface::change).function("action", &WebSurface::action)
      .function("invalidate", &WebSurface::invalidate);
}
