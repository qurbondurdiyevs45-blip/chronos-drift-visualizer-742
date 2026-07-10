#include "php.h"
#include "Zend/zend_extensions.h"
#include "Zend/zend_hooks.h"
#include <chrono>
#include <string>
#include <fstream>
#include <iomanip>

extern "C" {
    PHP_MINIT_FUNCTION(chronos_drift);
    PHP_MSHUTDOWN_FUNCTION(chronos_drift);
    PHP_RINIT_FUNCTION(chronos_drift);
    PHP_RSHUTDOWN_FUNCTION(chronos_drift);
}

static zend_op_array *(*original_zend_compile_file)(zend_file_handle *file_handle, int type);
static void (*original_zend_execute_ex)(zend_execute_data *execute_data);

struct ChronosContext {
    std::chrono::high_resolution_clock::time_point start_time;
    const char *service_name;
    const char *log_path;
};

static ChronosContext g_ctx;

static void chronos_log_drift(const std::string& event, double duration_ms) {
    std::ofstream log_file(g_ctx.log_path, std::ios_base::app);
    if (log_file.is_open()) {
        auto now = std::chrono::system_clock::now();
        auto ts = std::chrono::duration_cast<std::chrono::microseconds>(now.time_since_epoch()).count();
        log_file << ts << "|" << event << "|" << std::fixed << std::setprecision(6) << duration_ms << "\n";
    }
}

static void chronos_execute_ex(zend_execute_data *execute_data) {
    auto start = std::chrono::high_resolution_clock::now();
    
    original_zend_execute_ex(execute_data);
    
    auto end = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double, std::milli> drift = end - start;
    
    if (execute_data->func->common.function_name) {
        chronos_log_drift(ZSTR_VAL(execute_data->func->common.function_name), drift.count());
    }
}

PHP_MINIT_FUNCTION(chronos_drift) {
    g_ctx.log_path = "/var/log/chronos_drift.bin";
    g_ctx.service_name = "php-worker";
    
    original_zend_execute_ex = zend_execute_ex;
    zend_execute_ex = chronos_execute_ex;
    
    return SUCCESS;
}

PHP_MSHUTDOWN_FUNCTION(chronos_drift) {
    zend_execute_ex = original_zend_execute_ex;
    return SUCCESS;
}

PHP_RINIT_FUNCTION(chronos_drift) {
    g_ctx.start_time = std::chrono::high_resolution_clock::now();
    return SUCCESS;
}

PHP_RSHUTDOWN_FUNCTION(chronos_drift) {
    auto end = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double, std::milli> total_req_time = end - g_ctx.start_time;
    chronos_log_drift("REQUEST_TOTAL", total_req_time.count());
    return SUCCESS;
}

static zend_module_entry chronos_drift_module_entry = {
    STANDARD_MODULE_HEADER,
    "chronos_drift",
    NULL,
    PHP_MINIT(chronos_drift),
    PHP_MSHUTDOWN(chronos_drift),
    PHP_RINIT(chronos_drift),
    PHP_RSHUTDOWN(chronos_drift),
    NULL,
    "1.0.0",
    STANDARD_MODULE_PROPERTIES
};

#ifdef COMPILE_DL_CHRONOS_DRIFT
extern "C" {
    ZEND_GET_MODULE(chronos_drift)
}
#endif