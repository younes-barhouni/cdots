# RAPIDS Memory Manager (RMM)

This repository captures notes and quick-start guidance for working with **RAPIDS Memory Manager (RMM)**, the GPU memory allocation library used across the RAPIDS ecosystem. Use this README as a reference for what RMM provides and how to get started with it in Python or C++ projects.

## What is RMM?

RMM is a library that standardizes GPU memory management so RAPIDS libraries (and your own CUDA code) can allocate, deallocate, and monitor memory efficiently. Instead of relying on raw `cudaMalloc` calls, RMM exposes allocators that implement pooling, tracking, and logging so your application can:

- Reduce fragmentation and improve allocation speed with memory pools.
- Share a common allocator across libraries to avoid duplicated buffers.
- Collect allocation metrics for debugging and benchmarking.
- Swap allocation strategies (pool, arena, or standard CUDA) without changing call sites.

## Key components

- **Device memory resource (MR)** – The primary interface for allocating GPU memory. RMM ships several MRs, including a default CUDA allocator, a pool allocator, and an arena allocator.
- **Pool allocator** – Pre-allocates a large block on the GPU and services requests from it to speed up frequent allocations.
- **Arena allocator** – Groups allocations into arenas to further minimize fragmentation.
- **Logging and statistics** – Optional wrappers that record allocation events or expose usage metrics.

## Installing RMM

RMM ships with RAPIDS releases and is available on `conda` and `pip`.

```bash
# Using conda (recommended for RAPIDS stacks)
conda install -c rapidsai -c conda-forge rmm

# Using pip
pip install rmm
```

Make sure your environment includes a compatible CUDA toolkit version; consult the RAPIDS release notes for version compatibility.

## Python quick start

```python
import rmm

# Initialize RMM to use a default pool allocator (e.g., 512 MB)
rmm.reinitialize(pool_allocator=True, initial_pool_size=512 * 1024 * 1024)

# Access the current device memory resource
mr = rmm.mr.get_current_device_resource()

# Allocate and free device memory
buf = rmm.DeviceBuffer(size=1024)
print(f"Allocated {len(buf)} bytes on the GPU")

# When the buffer goes out of scope, memory is returned to the pool
```

Use the `rmm.mr` namespace to choose different allocators (such as `PoolMemoryResource` or `ArenaMemoryResource`) and to wrap them with logging or statistics collectors.

## C++ quick start

Include the RMM headers and select a memory resource to manage allocations in C++ code.

```cpp
#include <rmm/device_buffer.hpp>
#include <rmm/mr/device/pool_memory_resource.hpp>
#include <rmm/mr/device/arena_memory_resource.hpp>

// Create a pool allocator backed by CUDA's default allocator
rmm::mr::cuda_memory_resource cuda_mr;
rmm::mr::pool_memory_resource pool_mr{&cuda_mr};

// Use the pool for device buffers
rmm::device_buffer buffer{1024, rmm::cuda_stream_default, &pool_mr};
```

RMM's memory resources are composable; for example, you can wrap a pool allocator with a logging resource to record each allocation event.

## When to use RMM

- You need consistent GPU allocation behavior across multiple libraries.
- Your application performs many small allocations and suffers from fragmentation.
- You want allocation metrics or logging to help diagnose memory use.

## Further resources

- [RMM documentation](https://docs.rapids.ai/api/rmm/stable/)
- [RAPIDS release notes](https://docs.rapids.ai/)

This README should help you explain RMM to teammates and give them enough context to start experimenting with the library.
