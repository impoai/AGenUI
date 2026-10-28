#include "agenui_function_call_action_data_value.h"
#include "surface/datamodel/agenui_idata_model.h"
#include "surface/datamodel/agenui_data_observer.h"
#include "surface/virtual_dom/agenui_component_snapshot.h"
#include "surface/agenui_serializable_data_impl.h"
#include <cmath>

namespace agenui {

FunctionCallActionDataValue::FunctionCallActionDataValue(IDataValueContext* context, std::shared_ptr<FunctionCallDataValue> functionCall) : DataValue(context), _functionCall(functionCall) {
}

FunctionCallActionDataValue::~FunctionCallActionDataValue() {
    unbind();
}

DataType FunctionCallActionDataValue::getDataType() const {
    return DataType::FunctionCallActionData;
}

DataBindingStatus FunctionCallActionDataValue::getDataBindingStatus() const {
    if (!_functionCall) {
        return DataBindingStatus::NotDependent;
    }
    return _functionCall->getDataBindingStatus();
}

SerializableData FunctionCallActionDataValue::getValueData() const {
    auto impl = SerializableData::Impl::createObject();
    return SerializableData(impl);
}

std::shared_ptr<FunctionCallDataValue> FunctionCallActionDataValue::getFunctionCall() const {
    return _functionCall;
}

void FunctionCallActionDataValue::bind(IDataChangedObserver* observer) {
    if (_functionCall) {
        _functionCall->bind(observer);
    }
}

void FunctionCallActionDataValue::unbind() {
    if (_functionCall) {
        _functionCall->unbind();
    }
}

std::shared_ptr<DataValue> FunctionCallActionDataValue::cloneAsTemplate(IDataValueContext* context, const std::string& rootDataPath) const {
    std::shared_ptr<FunctionCallDataValue> clonedFunctionCall = nullptr;
    
    if (_functionCall) {
        auto clonedValue = _functionCall->cloneAsTemplate(context, rootDataPath);
        clonedFunctionCall = std::static_pointer_cast<FunctionCallDataValue>(clonedValue);
    }
    
    return std::make_shared<FunctionCallActionDataValue>(context, clonedFunctionCall);
}

SerializableData FunctionCallActionDataValue::execute() const {
    if (!_functionCall) {
        return SerializableData();
    }

    // State writes run only on a user action, never while evaluating a binding,
    // measuring a component, or refreshing a theme. The context is this surface.
    if (_functionCall->getFunctionName() == "setValue") {
        auto* model = _context ? _context->getDataModel() : nullptr;
        const auto args = _functionCall->getArgs();
        if (!model || args.size() != 2 || !args.count("targetPath") || !args.count("value")) return {};
        const auto target = args.at("targetPath")->getValueData();
        const auto path = target.asString();
        if (path.size() < 2 || path.size() > 512 || path.front() != '/') return {};
        const auto previous = model->getValue(path);
        const auto value = args.at("value")->getValueData();
        const bool sameType = (previous.isString() && value.isString()) ||
            (previous.isBool() && value.isBool()) || (previous.isNumber() && value.isNumber());
        if (!sameType || (value.isString() && value.asString().size() > 4000) ||
            (value.isNumber() && (!std::isfinite(value.asDouble()) || std::abs(value.asDouble()) > 1e12))) return {};
        model->updateData(path, value.dump());
        return value;
    }
    return _functionCall->getValueData();
}

}  // namespace agenui
