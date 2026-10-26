# Shipping Pickup Station Scanner

An industrial monitor billboard display for warehouse shipping and sorting bays.

## Supported Carriers & Destinations:
- **DHL**: Identifies DHL eCommerce barcodes (e.g. `420[ZIP]92419...` / Mailer ID `92419`) and 10-digit DHL Express airbills. Displays **DHL**.
- **UPSMI**: Identifies UPS Mail Innovations 18-digit+ tracking numbers starting with `80...` or `82...` (e.g. `803364829621565082`). Displays **UPSMI**.
- **FedEx Express**: 12-digit numeric barcodes (e.g. `879136980972`).
- **FedEx Ground**: 15-digit / 20-digit barcodes and `96...` GS1 barcodes.
- **UPS Ground / Next Day**: Standard `1Z...` tracking codes.
- **USPS**: Standard postal mail barcodes.
