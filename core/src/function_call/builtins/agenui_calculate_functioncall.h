#pragma once

#include "function_call/agenui_ifunctioncall.h"
#include <cmath>
#include <iomanip>
#include <locale>
#include <sstream>
#include <stdexcept>

namespace agenui {

// Bounded arithmetic, shared by native clients and Wasm. No script execution,
// identifiers, network access, or access to anything outside the supplied text.
class CalculateFunctionCall final : public IFunctionCall {
    class Parser {
        const std::string& text;
        size_t offset = 0;
        unsigned steps = 0;
        void space() { while (offset < text.size() && text[offset] == ' ') ++offset; }
        bool take(char c) { space(); if (offset < text.size() && text[offset] == c) { ++offset; return true; } return false; }
        double bounded(double value) {
            if (!std::isfinite(value) || std::abs(value) > 1e12) throw std::runtime_error("Result out of range");
            return value;
        }
        double factor(unsigned depth) {
            if (depth > 16 || ++steps > 128) throw std::runtime_error("Expression too complex");
            if (take('+')) return factor(depth + 1);
            if (take('-')) return -factor(depth + 1);
            if (take('(')) {
                const auto value = expression(depth + 1);
                if (!take(')')) throw std::runtime_error("Invalid expression");
                return value;
            }
            space(); const auto start = offset;
            bool digit = false;
            while (offset < text.size() && text[offset] >= '0' && text[offset] <= '9') { digit = true; ++offset; }
            if (offset < text.size() && text[offset] == '.') {
                ++offset;
                while (offset < text.size() && text[offset] >= '0' && text[offset] <= '9') { digit = true; ++offset; }
            }
            if (!digit) throw std::runtime_error("Invalid expression");
            if (offset < text.size() && (text[offset] == 'e' || text[offset] == 'E')) {
                ++offset;
                if (offset < text.size() && (text[offset] == '+' || text[offset] == '-')) ++offset;
                const auto exponent = offset;
                while (offset < text.size() && text[offset] >= '0' && text[offset] <= '9') ++offset;
                if (exponent == offset) throw std::runtime_error("Invalid expression");
            }
            std::istringstream input(text.substr(start, offset - start));
            input.imbue(std::locale::classic());
            double value;
            if (!(input >> value)) throw std::runtime_error("Result out of range");
            return bounded(value);
        }
        double product(unsigned depth) {
            double value = factor(depth);
            for (;;) {
                if (take('*')) value = bounded(value * factor(depth));
                else if (take('/')) {
                    const auto divisor = factor(depth);
                    if (divisor == 0) throw std::runtime_error("Cannot divide by zero");
                    value = bounded(value / divisor);
                } else return value;
            }
        }
        double expression(unsigned depth) {
            double value = product(depth);
            for (;;) {
                if (take('+')) value = bounded(value + product(depth));
                else if (take('-')) value = bounded(value - product(depth));
                else return value;
            }
        }
    public:
        explicit Parser(const std::string& value) : text(value) {}
        double parse() {
            if (text.empty() || text.size() > 512) throw std::runtime_error("Invalid expression");
            const auto value = expression(0); space();
            if (offset != text.size()) throw std::runtime_error("Invalid expression");
            return value;
        }
    };
public:
    FunctionCallResolution execute(const nlohmann::json& args) override {
        if (!args.contains("expression") || !args["expression"].is_string())
            return FunctionCallResolution::createError("Expected expression text");
        try {
            const auto text = args["expression"].get<std::string>();
            const auto value = Parser(text).parse();
            std::ostringstream output;
            output.imbue(std::locale::classic());
            output << std::setprecision(15) << (value == 0 ? 0 : value);
            return FunctionCallResolution::createSuccess(output.str());
        } catch (const std::runtime_error& error) {
            // A displayable local error keeps the card usable; Clear can reset it.
            return FunctionCallResolution::createSuccess(std::string(error.what()));
        }
    }
    FunctionCallConfig getConfig() const override {
        FunctionCallConfig config;
        config.setName("calculate");
        config.setDescription("Evaluates bounded arithmetic text locally: decimal numbers, +, -, *, / and parentheses. Returns result or error text.");
        config.setReturnType("string");
        return config;
    }
};

} // namespace agenui
