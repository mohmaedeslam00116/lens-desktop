# Explicit Wide Research and Dependency Free Report Export

Wide Research is selected only through `mode: 'wide'`, rather than inferring it from a depth label, so standard research remains direct and predictable. The separate execution seam begins with a 100-source retrieval budget, expands that budget only when evidence coverage requires it, and stops at 200; actual retrieved counts are surfaced as telemetry. PDF rendering uses Chromium in the desktop process and DOCX uses standard OOXML over the existing pure Node ZIP writer, avoiding new native dependencies.
