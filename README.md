# Shipping Pickup Station Scanner

An industrial monitor billboard display for warehouse shipping and sorting bays.

## Updates
- **No Emojis**: Clean, professional industrial typography and high-visibility neon indicators.
- **Immediate Scan Burst Detection**: Automatically submits the instant the barcode scan finishes (65ms idle burst threshold), with zero 1-second lag. Also supports Enter key.
- **Distinct FedEx Ground vs FedEx Express Routing**:
  - **FedEx Express**: 12-digit standard airbill tracking numbers (e.g. `879136980972`).
  - **FedEx Ground**: 15-digit / 20-digit barcodes and `96...` GS1 barcodes.
