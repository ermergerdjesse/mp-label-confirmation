# Shipping Pickup Station Scanner

Created this for ease of use to determine the correct location to put a package

## Supported Carriers & Destinations:
- **DHL**: Identifies DHL eCommerce barcodes (e.g. `420[ZIP]92419...` / Mailer ID `92419`) and 10-digit DHL Express airbills. Displays **DHL**.
- **UPSMI**: Identifies UPS Mail Innovations 18-digit+ tracking numbers starting with `80...` or `82...` (e.g. `803364829621565082`). Displays **UPSMI**.
- **FedEx Express**: 12-digit numeric barcodes (e.g. `879136980972`).
- **FedEx Ground**: 15-digit / 20-digit barcodes and `96...` GS1 barcodes.
- **UPS Ground / Next Day**: Standard `1Z...` tracking codes.
- **USPS**: Standard postal mail barcodes.
- Removed "SCANNED & VERIFIED" text to give maximum screen size to the carrier destination.
- Separated 12-digit FedEx Ground / SmartPost (prefixes starting with 30-39) from FedEx Express.
- Auto-enters text after a bit, (60 ms)
