FROM node:20-alpine
WORKDIR /app
# No npm deps required for this lightweight stub; just copy source
COPY index.js ./
COPY quantized-runner /usr/local/bin/quantized-runner
RUN chmod +x /usr/local/bin/quantized-runner
EXPOSE 8080
# Install runtime deps and build tools, then install npm deps
# Install build deps (include linux-headers) and npm deps
RUN apk add --no-cache git build-base cmake python3 make bash linux-headers \
	&& npm init -y \
	&& npm install express body-parser --production

# Clone and build a local quantized runner (llama.cpp) using CMake.
# Note: this increases image size and build time.
RUN git clone --depth 1 https://github.com/ggerganov/llama.cpp /opt/llama.cpp \
	&& cd /opt/llama.cpp \
	&& mkdir -p build \
	&& cd build \
	&& cmake .. -DCMAKE_BUILD_TYPE=Release \
	&& cmake --build . -j2 || true \
	&& \
	# Find the first executable produced under the build directory and copy it to /opt/llama.cpp/main
	EXEC=$(find . -type f -perm -111 -exec sh -c 'file -b --mime-type "$1" | grep -q "application/x-executable" && printf "%s\n" "$1" || true' sh {} \; | head -n1) || true \
	&& if [ -n "$EXEC" ]; then cp "$EXEC" /opt/llama.cpp/main; fi || true

# Point the wrapper at the real compiled runner if present
ENV LOCAL_LLM_QUANTIZED_RUNNER_REAL=/opt/llama.cpp/main
CMD ["node", "index.js"]
