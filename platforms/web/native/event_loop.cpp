// Copyright 2026 Impo. SPDX-License-Identifier: Apache-2.0
// Web-only implementation of the existing scheduling interface. No pthreads,
// SharedArrayBuffer or cross-origin isolation is needed. Tasks stay asynchronous
// and ordered; callbacks never reenter the core on the submitter's stack.
#include "module/agenui_thread_manager.h"
#include <emscripten/eventloop.h>
#include <map>
#include <utility>

namespace agenui {
namespace {
class EventLoopThread final : public IThread {
  struct Pending;
  struct State {
    bool running = false;
    std::map<long, std::unique_ptr<Pending>> pending;
  };
  struct Pending {
    std::weak_ptr<State> state;
    std::function<void()> task;
    long timer = 0;
  };
  std::shared_ptr<State> state_ = std::make_shared<State>();
 public:
  ~EventLoopThread() override { stop(); }
  bool start() override { state_->running = true; return true; }
  bool isRunning() const override { return state_->running; }
  void stop() override {
    state_->running = false;
    for (const auto& pair : state_->pending) emscripten_clear_timeout(pair.first);
    state_->pending.clear();
  }
  void post(std::function<void()> task) override { postDelayed(std::move(task), 0); }
  void postDelayed(std::function<void()> task, unsigned long delay) override {
    if (!state_->running) return;
    auto pending = std::make_unique<Pending>();
    pending->state = state_;
    pending->task = std::move(task);
    pending->timer = emscripten_set_timeout([](void* pointer) {
      auto* item = static_cast<Pending*>(pointer);
      auto state = item->state.lock();
      if (!state || !state->running) return;
      auto task = std::move(item->task);
      state->pending.erase(item->timer);
      task();
    }, static_cast<double>(delay), pending.get());
    const auto timer = pending->timer;
    state_->pending.emplace(timer, std::move(pending));
  }
};
}  // namespace
ThreadManager& ThreadManager::getInstance() { static ThreadManager instance; return instance; }
ThreadManager::~ThreadManager() { for (auto& pair : _threads) pair.second->stop(); }
bool ThreadManager::createThread(int id) {
  if (_threads.count(id)) return true;
  auto thread = std::make_shared<EventLoopThread>();
  thread->start();
  _threads.emplace(id, std::move(thread));
  return true;
}
void ThreadManager::destroyThread(int id) {
  auto it = _threads.find(id);
  if (it == _threads.end()) return;
  auto thread = std::move(it->second);
  _threads.erase(it);
  thread->stop();
}
std::shared_ptr<IThread> ThreadManager::getMessageThread(int id) {
  auto it = _threads.find(id);
  return it == _threads.end() ? nullptr : it->second;
}
}  // namespace agenui
