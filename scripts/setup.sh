#!/bin/bash

# Chronos Drift Visualizer - Environment Setup & Native Compilation Script
# This script prepares the multi-language environment and compiles high-performance engines.

set -e

# --- Configuration ---
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$PROJECT_ROOT/bin"
ZIG_VERSION="0.11.0"
GO_VERSION="1.21"
RUST_VERSION="stable"

# Create directories
mkdir -p "$BIN_DIR"

echo "--- Initializing Chronos Drift Visualizer Environment ---"

# 1. Dependency Check
check_tool() {
    if ! command -v "$1" &> /dev/null; then
        echo "Error: $1 is required but not installed."
        exit 1
    fi
}

check_tool zig
check_tool rustc
check_tool go
check_tool node
check_tool python3
check_tool g++
check_tool java
check_tool dotnet

# 2. Compile Zig-Optimized Binary Parser (The Core Engine)
echo "Compiling Zig Binary Parser (Forensic Engine)..."
cd "$PROJECT_ROOT/src/native/zig_parser"
zig build-exe main.zig -O ReleaseFast --name chronos-parser
mv chronos-parser "$BIN_DIR/"

# 3. Compile Rust Drift Analyzer
echo "Compiling Rust Drift Analyzer (Statistical Analysis)..."
cd "$PROJECT_ROOT/src/native/rust_analyzer"
cargo build --release
cp target/release/drift-analyzer "$BIN_DIR/"

# 4. Compile Go Synchronizer (Distributed Collection)
echo "Compiling Go Microservice Synchronizer..."
cd "$PROJECT_ROOT/src/services/go_sync"
go build -ldflags="-s -w" -o "$BIN_DIR/go-collector" main.go

# 5. Compile C++ Jitter Hook
echo "Compiling C++ Low-Level Jitter Hook..."
cd "$PROJECT_ROOT/src/native/cpp_hooks"
g++ -O3 -shared -fPIC jitter_hook.cpp -o "$BIN_DIR/libjitter_hook.so"

# 6. Install Node.js Dependencies (Frontend & WebGL)
echo "Installing Node.js dependencies for WebGL Visualizer..."
cd "$PROJECT_ROOT/src/web"
npm install

# 7. Setup Python Forensic Tools
echo "Setting up Python forensic analysis environment..."
cd "$PROJECT_ROOT/scripts"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
fi
deactivate

# 8. Compile JVM Components (Kotlin/Java Bridge)
echo "Compiling Kotlin/Java Bridge Components..."
cd "$PROJECT_ROOT/src/services/jvm_bridge"
./gradlew build
cp build/libs/jvm-bridge-all.jar "$BIN_DIR/"

# 9. Setup C# Backend
echo "Compiling .NET Drift Aggregator..."
cd "$PROJECT_ROOT/src/services/dotnet_aggregator"
dotnet publish -c Release -o "$BIN_DIR/dotnet_aggregator"

# 10. Verification
echo "--- Build Summary ---"
ls -lh "$BIN_DIR"

echo "Chronos Drift Visualizer is successfully provisioned."
echo "Native components compiled for: $(uname -m)-$(uname -s)"
echo "Run './bin/chronos-parser --help' to verify the core engine."