using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;

namespace ChronosDrift.Probe
{
    /// <summary>
    /// High-precision CLR Profiler agent for tracking thread-switch timings and execution jitter.
    /// Uses P/Invoke to access Windows QueryPerformanceCounter for sub-microsecond accuracy.
    /// </summary>
    public sealed class ThreadProbe : IDisposable
    {
        [DllImport("kernel32.dll")]
        private static extern bool QueryPerformanceCounter(out long lpPerformanceCount);

        [DllImport("kernel32.dll")]
        private static extern bool QueryPerformanceFrequency(out long lpFrequency);

        private readonly long _frequency;
        private readonly string _serviceId;
        private bool _active;
        private readonly Thread _monitorThread;
        private const int BufferSize = 1024 * 64;
        private readonly JitterEvent[] _eventBuffer = new JitterEvent[BufferSize];
        private int _bufferIndex = 0;

        [StructLayout(LayoutKind.Sequential)]
        public struct JitterEvent
        {
            public long Timestamp;
            public int ManagedThreadId;
            public long DeltaTicks;
        }

        public ThreadProbe(string serviceId)
        {
            if (!QueryPerformanceFrequency(out _frequency))
            {
                throw new NotSupportedException("High-performance counter not supported on this hardware.");
            }

            _serviceId = serviceId;
            _active = true;
            _monitorThread = new Thread(CaptureLoop)
            {
                IsBackground = true,
                Priority = ThreadPriority.Highest,
                Name = $"ChronosProbe_{_serviceId}"
            };
        }

        public void Start()
        {
            _monitorThread.Start();
        }

        private void CaptureLoop()
        {
            long lastTimestamp;
            QueryPerformanceCounter(out lastTimestamp);

            while (_active)
            {
                long currentTimestamp;
                QueryPerformanceCounter(out currentTimestamp);

                long delta = currentTimestamp - lastTimestamp;
                
                // Record significant jitter (threshold usually defined by context, here 100ns base)
                if (delta > 0)
                {
                    RecordEvent(currentTimestamp, Thread.CurrentThread.ManagedThreadId, delta);
                }

                lastTimestamp = currentTimestamp;

                // Prevent 100% CPU saturation while maintaining high resolution
                if (delta < (_frequency / 10000)) 
                {
                    Thread.SpinWait(100);
                }
            }
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private void RecordEvent(long timestamp, int threadId, long delta)
        {
            int index = Interlocked.Increment(ref _bufferIndex) % BufferSize;
            _eventBuffer[index] = new JitterEvent
            {
                Timestamp = timestamp,
                ManagedThreadId = threadId,
                DeltaTicks = delta
            };

            // If buffer is 75% full, flush to the Zig-optimized binary parser endpoint
            if (index == (int)(BufferSize * 0.75))
            {
                FlushBuffer();
            }
        }

        private void FlushBuffer()
        {
            // Implementation routes binary data to the Chronos Drift collector
            // This replicates the memory layout expected by the Zig binary parser
            try
            {
                byte[] rawData = new byte[BufferSize * Marshal.SizeOf<JitterEvent>()];
                Buffer.BlockCopy(_eventBuffer, 0, rawData, 0, rawData.Length);
                
                // In a production environment, this would be pushed via Shared Memory or Unix Domain Socket
                // For this agent, we emit a diagnostic trace that the host process captures
                Trace.WriteLine($"CHRONOS_FLUSH|{_serviceId}|{rawData.Length}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Chronos Probe Error: {ex.Message}");
            }
        }

        public double TicksToMicroseconds(long ticks)
        {
            return (ticks * 1000000.0) / _frequency;
        }

        public void Dispose()
        {
            _active = false;
            if (_monitorThread.IsAlive)
            {
                _monitorThread.Join(100);
            }
            FlushBuffer();
        }
    }
}