const std = @import("std");

/// Chronos Drift Record represents a single execution event captured from a microservice.
/// Layout is optimized for 32-byte alignment to maximize cache line efficiency.
pub const DriftRecord = packed struct {
    /// Unix nanoseconds (UTC)
    timestamp: i64,
    /// Duration of the execution block in nanoseconds
    duration: u64,
    /// Service ID hash (FNV-1a or similar)
    service_id: u32,
    /// Checksum for data integrity
    checksum: u32,
    /// Reserved for future flags/padding
    _reserved: u64,
};

pub const ParserError = error{
    InvalidHeader,
    CorruptData,
    EndOfStream,
    BufferTooSmall,
};

/// High-performance zero-copy parser for Chronos binary logs (.cbl)
pub const BinaryParser = struct {
    const MAGIC_HEADER = "CHRN";
    const VERSION: u16 = 1;

    buffer: []const u8,
    pos: usize,

    pub fn init(data: []const u8) !BinaryParser {
        if (data.len < 8) return ParserError.InvalidHeader;
        if (!std.mem.eql(u8, data[0..4], MAGIC_HEADER)) return ParserError.InvalidHeader;
        
        const version = std.mem.readInt(u16, data[4..6], .little);
        if (version != VERSION) return ParserError.InvalidHeader;

        return BinaryParser{
            .buffer = data,
            .pos = 8, // Skip header
        };
    }

    /// Returns a slice of DriftRecords directly pointing to the memory-mapped buffer.
    /// This ensures zero-copy overhead for high-throughput visualization.
    pub fn parseAllStatic(self: *BinaryParser) ![]const DriftRecord {
        const remaining = self.buffer.len - self.pos;
        const record_size = @sizeOf(DriftRecord);
        
        if (remaining % record_size != 0) return ParserError.CorruptData;
        
        const count = remaining / record_size;
        const ptr = @ptrCast([*]const DriftRecord, @alignCast(@alignOf(DriftRecord), self.buffer[self.pos..].ptr));
        
        self.pos = self.buffer.len;
        return ptr[0..count];
    }

    /// Validates record integrity using the embedded checksum
    pub fn validateRecord(record: *const DriftRecord) bool {
        var hasher = std.hash.Fnv1a_32.init();
        const ts_bytes = std.mem.asBytes(&record.timestamp);
        const dur_bytes = std.mem.asBytes(&record.duration);
        const svc_bytes = std.mem.asBytes(&record.service_id);
        
        hasher.update(ts_bytes);
        hasher.update(dur_bytes);
        hasher.update(svc_bytes);
        
        return record.checksum == hasher.final();
    }
};

/// Entry point for WASM-based ingestion in the web visualizer
export fn process_log_buffer(ptr: [*]const u8, len: usize) i32 {
    const data = ptr[0..len];
    var parser = BinaryParser.init(data) catch return -1;
    
    const records = parser.parseAllStatic() catch return -2;
    
    var valid_count: i32 = 0;
    for (records) |*record| {
        if (BinaryParser.validateRecord(record)) {
            valid_count += 1;
        }
    }
    
    return valid_count;
}

test "parser_integrity_check" {
    const allocator = std.testing.allocator;
    
    // Construct mock valid header
    var mock_data = std.ArrayList(u8).init(allocator);
    defer mock_data.deinit();
    try mock_data.appendSlice("CHRN");
    try mock_data.appendSlice(&[_]u8{ 0x01, 0x00, 0x00, 0x00 }); // Version 1 + padding
    
    const record = DriftRecord{
        .timestamp = 1672531200000000000,
        .duration = 45000,
        .service_id = 101,
        .checksum = 0, // Placeholder
        ._reserved = 0,
    };
    
    // Calculate valid checksum
    var hasher = std.hash.Fnv1a_32.init();
    hasher.update(std.mem.asBytes(&record.timestamp));
    hasher.update(std.mem.asBytes(&record.duration));
    hasher.update(std.mem.asBytes(&record.service_id));
    
    var final_record = record;
    final_record.checksum = hasher.final();
    
    try mock_data.appendSlice(std.mem.asBytes(&final_record));
    
    var parser = try BinaryParser.init(mock_data.items);
    const results = try parser.parseAllStatic();
    
    try std.testing.expect(results.len == 1);
    try std.testing.expect(BinaryParser.validateRecord(&results[0]));
    try std.testing.expectEqual(results[0].service_id, 101);
}