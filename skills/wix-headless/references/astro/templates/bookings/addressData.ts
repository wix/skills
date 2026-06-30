// addressData.ts — BAKED Wix multi-line-address templates (generated, do not hand-edit).
// Source: Wix form-template-service (the same per-country address layouts the Wix
// dashboard form uses). Baked so the booking form renders FAITHFUL country/region
// dropdowns + the right sub-fields per country, with NO runtime fetch and NO Wix
// render components. 66 countries → 12 templates; unlisted countries fall back to COMMON
// (address/city/postal, no region dropdown) — matching Wix's own COMMON fallback.

export interface AddressSubField {
  target: string;          // submission key inside the address object
  label: string;
  required: boolean;
  width: number;           // grid columns out of 12 (region+zip share a row, etc.)
  options?: { value: string; label: string }[]; // present → render a <select> (e.g. US states)
}

// ISO-3166-1 alpha-2 country code → address template id.
export const COUNTRY_TEMPLATE_MAP: Record<string, string> = {
  "COMMON": "0d5dcb6d-1403-4b80-b73e-6d90a2245561",
  "US": "ebe1c447-8fd5-4c7a-8cf1-75b94db68698",
  "UY": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "TH": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "TR": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "SZ": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "ZA": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "SE": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "SI": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "SK": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "RS": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "SB": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "SG": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "SN": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "SD": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "RU": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "RO": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "PY": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "PT": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "PL": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "PH": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "PE": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "PA": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "PK": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "NZ": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "NO": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "NG": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "NL": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "MY": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "MH": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "MX": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "KR": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "JP": "e51fc7b5-0c29-40c6-b2e8-58d9fa5e3c29",
  "IT": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "IS": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "IE": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "IN": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "IL": "bc7a8d54-8df3-47cb-bb9b-3338fd6246e5",
  "ID": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "HU": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "HR": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "GR": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "GB": "3d059d26-8ce8-48ce-9779-b23e42014454",
  "FR": "fbc1fb24-37bc-4c0f-afa4-35e88a43127d",
  "ES": "f0e74759-d378-4ae7-9db7-42b4c7d02094",
  "EG": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "DO": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "DK": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "DE": "c7bde0e2-187e-44e7-8f51-14162259eb2b",
  "CZ": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "CY": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "CR": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "CO": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "CI": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "CN": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "CL": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "CH": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "CA": "2b942888-7d93-41ee-b85c-5705263f9eea",
  "CF": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "BR": "3160f799-1ade-455b-87f9-128875ec874e",
  "BS": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "BE": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "BG": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "AT": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "AU": "76f1a42e-b609-4c8b-b41a-7ebf2fbb5a56",
  "AR": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d",
  "AE": "b7b59987-e5c6-4ec7-a4af-f48318a68a5d"
};

// template id → ordered visible sub-fields.
export const ADDRESS_TEMPLATES: Record<string, AddressSubField[]> = {
  "0d5dcb6d-1403-4b80-b73e-6d90a2245561": [
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 12
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 12
    }
  ],
  "ebe1c447-8fd5-4c7a-8cf1-75b94db68698": [
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 12
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 6,
      "options": [
        {
          "value": "AA",
          "label": "AA"
        },
        {
          "value": "AE",
          "label": "AE"
        },
        {
          "value": "AK",
          "label": "AK"
        },
        {
          "value": "AL",
          "label": "AL"
        },
        {
          "value": "AP",
          "label": "AP"
        },
        {
          "value": "AR",
          "label": "AR"
        },
        {
          "value": "AZ",
          "label": "AZ"
        },
        {
          "value": "CA",
          "label": "CA"
        },
        {
          "value": "CO",
          "label": "CO"
        },
        {
          "value": "CT",
          "label": "CT"
        },
        {
          "value": "DC",
          "label": "DC"
        },
        {
          "value": "DE",
          "label": "DE"
        },
        {
          "value": "FL",
          "label": "FL"
        },
        {
          "value": "GA",
          "label": "GA"
        },
        {
          "value": "HI",
          "label": "HI"
        },
        {
          "value": "IA",
          "label": "IA"
        },
        {
          "value": "ID",
          "label": "ID"
        },
        {
          "value": "IL",
          "label": "IL"
        },
        {
          "value": "IN",
          "label": "IN"
        },
        {
          "value": "KS",
          "label": "KS"
        },
        {
          "value": "KY",
          "label": "KY"
        },
        {
          "value": "LA",
          "label": "LA"
        },
        {
          "value": "MA",
          "label": "MA"
        },
        {
          "value": "MD",
          "label": "MD"
        },
        {
          "value": "ME",
          "label": "ME"
        },
        {
          "value": "MI",
          "label": "MI"
        },
        {
          "value": "MN",
          "label": "MN"
        },
        {
          "value": "MO",
          "label": "MO"
        },
        {
          "value": "MS",
          "label": "MS"
        },
        {
          "value": "MT",
          "label": "MT"
        },
        {
          "value": "NC",
          "label": "NC"
        },
        {
          "value": "ND",
          "label": "ND"
        },
        {
          "value": "NE",
          "label": "NE"
        },
        {
          "value": "NH",
          "label": "NH"
        },
        {
          "value": "NJ",
          "label": "NJ"
        },
        {
          "value": "NM",
          "label": "NM"
        },
        {
          "value": "NV",
          "label": "NV"
        },
        {
          "value": "NY",
          "label": "NY"
        },
        {
          "value": "OH",
          "label": "OH"
        },
        {
          "value": "OK",
          "label": "OK"
        },
        {
          "value": "OR",
          "label": "OR"
        },
        {
          "value": "PA",
          "label": "PA"
        },
        {
          "value": "RI",
          "label": "RI"
        },
        {
          "value": "SC",
          "label": "SC"
        },
        {
          "value": "SD",
          "label": "SD"
        },
        {
          "value": "TN",
          "label": "TN"
        },
        {
          "value": "TX",
          "label": "TX"
        },
        {
          "value": "UT",
          "label": "UT"
        },
        {
          "value": "VA",
          "label": "VA"
        },
        {
          "value": "VT",
          "label": "VT"
        },
        {
          "value": "WA",
          "label": "WA"
        },
        {
          "value": "WI",
          "label": "WI"
        },
        {
          "value": "WV",
          "label": "WV"
        },
        {
          "value": "WY",
          "label": "WY"
        }
      ]
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 6
    }
  ],
  "b7b59987-e5c6-4ec7-a4af-f48318a68a5d": [
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 12
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 12
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 12
    }
  ],
  "e51fc7b5-0c29-40c6-b2e8-58d9fa5e3c29": [
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 12
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 12,
      "options": [
        {
          "value": "01",
          "label": "01"
        },
        {
          "value": "02",
          "label": "02"
        },
        {
          "value": "03",
          "label": "03"
        },
        {
          "value": "04",
          "label": "04"
        },
        {
          "value": "05",
          "label": "05"
        },
        {
          "value": "06",
          "label": "06"
        },
        {
          "value": "07",
          "label": "07"
        },
        {
          "value": "08",
          "label": "08"
        },
        {
          "value": "09",
          "label": "09"
        },
        {
          "value": "10",
          "label": "10"
        },
        {
          "value": "11",
          "label": "11"
        },
        {
          "value": "12",
          "label": "12"
        },
        {
          "value": "13",
          "label": "13"
        },
        {
          "value": "14",
          "label": "14"
        },
        {
          "value": "15",
          "label": "15"
        },
        {
          "value": "16",
          "label": "16"
        },
        {
          "value": "17",
          "label": "17"
        },
        {
          "value": "18",
          "label": "18"
        },
        {
          "value": "19",
          "label": "19"
        },
        {
          "value": "20",
          "label": "20"
        },
        {
          "value": "21",
          "label": "21"
        },
        {
          "value": "22",
          "label": "22"
        },
        {
          "value": "23",
          "label": "23"
        },
        {
          "value": "24",
          "label": "24"
        },
        {
          "value": "25",
          "label": "25"
        },
        {
          "value": "26",
          "label": "26"
        },
        {
          "value": "27",
          "label": "27"
        },
        {
          "value": "28",
          "label": "28"
        },
        {
          "value": "29",
          "label": "29"
        },
        {
          "value": "30",
          "label": "30"
        },
        {
          "value": "31",
          "label": "31"
        },
        {
          "value": "32",
          "label": "32"
        },
        {
          "value": "33",
          "label": "33"
        },
        {
          "value": "34",
          "label": "34"
        },
        {
          "value": "35",
          "label": "35"
        },
        {
          "value": "36",
          "label": "36"
        },
        {
          "value": "37",
          "label": "37"
        },
        {
          "value": "38",
          "label": "38"
        },
        {
          "value": "39",
          "label": "39"
        },
        {
          "value": "40",
          "label": "40"
        },
        {
          "value": "41",
          "label": "41"
        },
        {
          "value": "42",
          "label": "42"
        },
        {
          "value": "43",
          "label": "43"
        },
        {
          "value": "44",
          "label": "44"
        },
        {
          "value": "45",
          "label": "45"
        },
        {
          "value": "46",
          "label": "46"
        },
        {
          "value": "47",
          "label": "47"
        }
      ]
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 12
    },
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    }
  ],
  "bc7a8d54-8df3-47cb-bb9b-3338fd6246e5": [
    {
      "target": "streetName",
      "label": "Street",
      "required": true,
      "width": 6
    },
    {
      "target": "streetNumber",
      "label": "No.",
      "required": true,
      "width": 6
    },
    {
      "target": "addressLine2",
      "label": "Address line 2",
      "required": false,
      "width": 12
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 12
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": false,
      "width": 12
    }
  ],
  "3d059d26-8ce8-48ce-9779-b23e42014454": [
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 12
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 6,
      "options": [
        {
          "value": "ENG",
          "label": "ENG"
        },
        {
          "value": "NIR",
          "label": "NIR"
        },
        {
          "value": "SCT",
          "label": "SCT"
        },
        {
          "value": "WLS",
          "label": "WLS"
        }
      ]
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 6
    }
  ],
  "fbc1fb24-37bc-4c0f-afa4-35e88a43127d": [
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 6
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 6
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 12,
      "options": [
        {
          "value": "ARA",
          "label": "ARA"
        },
        {
          "value": "BFC",
          "label": "BFC"
        },
        {
          "value": "BRE",
          "label": "BRE"
        },
        {
          "value": "CVL",
          "label": "CVL"
        },
        {
          "value": "20R",
          "label": "20R"
        },
        {
          "value": "GES",
          "label": "GES"
        },
        {
          "value": "HDF",
          "label": "HDF"
        },
        {
          "value": "IDF",
          "label": "IDF"
        },
        {
          "value": "NOR",
          "label": "NOR"
        },
        {
          "value": "NAQ",
          "label": "NAQ"
        },
        {
          "value": "OCC",
          "label": "OCC"
        },
        {
          "value": "PDL",
          "label": "PDL"
        },
        {
          "value": "PAC",
          "label": "PAC"
        },
        {
          "value": "BL",
          "label": "BL"
        },
        {
          "value": "RE",
          "label": "RE"
        },
        {
          "value": "TF",
          "label": "TF"
        }
      ]
    }
  ],
  "f0e74759-d378-4ae7-9db7-42b4c7d02094": [
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 12
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 6,
      "options": [
        {
          "value": "AN",
          "label": "AN"
        },
        {
          "value": "AR",
          "label": "AR"
        },
        {
          "value": "AS",
          "label": "AS"
        },
        {
          "value": "CB",
          "label": "CB"
        },
        {
          "value": "CE",
          "label": "CE"
        },
        {
          "value": "CL",
          "label": "CL"
        },
        {
          "value": "CM",
          "label": "CM"
        },
        {
          "value": "CN",
          "label": "CN"
        },
        {
          "value": "CT",
          "label": "CT"
        },
        {
          "value": "EX",
          "label": "EX"
        },
        {
          "value": "GA",
          "label": "GA"
        },
        {
          "value": "IB",
          "label": "IB"
        },
        {
          "value": "MC",
          "label": "MC"
        },
        {
          "value": "MD",
          "label": "MD"
        },
        {
          "value": "ML",
          "label": "ML"
        },
        {
          "value": "NC",
          "label": "NC"
        },
        {
          "value": "PV",
          "label": "PV"
        },
        {
          "value": "RI",
          "label": "RI"
        },
        {
          "value": "VC",
          "label": "VC"
        }
      ]
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 6
    }
  ],
  "c7bde0e2-187e-44e7-8f51-14162259eb2b": [
    {
      "target": "streetName",
      "label": "Street",
      "required": true,
      "width": 6
    },
    {
      "target": "streetNumber",
      "label": "No.",
      "required": true,
      "width": 6
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 6
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 6
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 12,
      "options": [
        {
          "value": "BB",
          "label": "BB"
        },
        {
          "value": "BE",
          "label": "BE"
        },
        {
          "value": "BW",
          "label": "BW"
        },
        {
          "value": "BY",
          "label": "BY"
        },
        {
          "value": "HB",
          "label": "HB"
        },
        {
          "value": "HE",
          "label": "HE"
        },
        {
          "value": "HH",
          "label": "HH"
        },
        {
          "value": "MV",
          "label": "MV"
        },
        {
          "value": "NI",
          "label": "NI"
        },
        {
          "value": "NW",
          "label": "NW"
        },
        {
          "value": "RP",
          "label": "RP"
        },
        {
          "value": "SH",
          "label": "SH"
        },
        {
          "value": "SL",
          "label": "SL"
        },
        {
          "value": "SN",
          "label": "SN"
        },
        {
          "value": "ST",
          "label": "ST"
        },
        {
          "value": "TH",
          "label": "TH"
        }
      ]
    }
  ],
  "2b942888-7d93-41ee-b85c-5705263f9eea": [
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 12
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 6,
      "options": [
        {
          "value": "AB",
          "label": "AB"
        },
        {
          "value": "BC",
          "label": "BC"
        },
        {
          "value": "MB",
          "label": "MB"
        },
        {
          "value": "NB",
          "label": "NB"
        },
        {
          "value": "NL",
          "label": "NL"
        },
        {
          "value": "NS",
          "label": "NS"
        },
        {
          "value": "NT",
          "label": "NT"
        },
        {
          "value": "NU",
          "label": "NU"
        },
        {
          "value": "ON",
          "label": "ON"
        },
        {
          "value": "PE",
          "label": "PE"
        },
        {
          "value": "QC",
          "label": "QC"
        },
        {
          "value": "SK",
          "label": "SK"
        },
        {
          "value": "YT",
          "label": "YT"
        }
      ]
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 6
    }
  ],
  "3160f799-1ade-455b-87f9-128875ec874e": [
    {
      "target": "streetName",
      "label": "Street",
      "required": true,
      "width": 6
    },
    {
      "target": "streetNumber",
      "label": "No.",
      "required": true,
      "width": 6
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 6
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 6,
      "options": [
        {
          "value": "AC",
          "label": "AC"
        },
        {
          "value": "AL",
          "label": "AL"
        },
        {
          "value": "AM",
          "label": "AM"
        },
        {
          "value": "AP",
          "label": "AP"
        },
        {
          "value": "BA",
          "label": "BA"
        },
        {
          "value": "CE",
          "label": "CE"
        },
        {
          "value": "DF",
          "label": "DF"
        },
        {
          "value": "ES",
          "label": "ES"
        },
        {
          "value": "GO",
          "label": "GO"
        },
        {
          "value": "MA",
          "label": "MA"
        },
        {
          "value": "MG",
          "label": "MG"
        },
        {
          "value": "MS",
          "label": "MS"
        },
        {
          "value": "MT",
          "label": "MT"
        },
        {
          "value": "PA",
          "label": "PA"
        },
        {
          "value": "PB",
          "label": "PB"
        },
        {
          "value": "PE",
          "label": "PE"
        },
        {
          "value": "PI",
          "label": "PI"
        },
        {
          "value": "PR",
          "label": "PR"
        },
        {
          "value": "RJ",
          "label": "RJ"
        },
        {
          "value": "RN",
          "label": "RN"
        },
        {
          "value": "RO",
          "label": "RO"
        },
        {
          "value": "RR",
          "label": "RR"
        },
        {
          "value": "RS",
          "label": "RS"
        },
        {
          "value": "SC",
          "label": "SC"
        },
        {
          "value": "SE",
          "label": "SE"
        },
        {
          "value": "SP",
          "label": "SP"
        },
        {
          "value": "TO",
          "label": "TO"
        }
      ]
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 12
    }
  ],
  "76f1a42e-b609-4c8b-b41a-7ebf2fbb5a56": [
    {
      "target": "addressLine",
      "label": "Address",
      "required": true,
      "width": 12
    },
    {
      "target": "city",
      "label": "City",
      "required": true,
      "width": 4
    },
    {
      "target": "subdivision",
      "label": "State / Region",
      "required": true,
      "width": 4,
      "options": [
        {
          "value": "ACT",
          "label": "ACT"
        },
        {
          "value": "NSW",
          "label": "NSW"
        },
        {
          "value": "NT",
          "label": "NT"
        },
        {
          "value": "QLD",
          "label": "QLD"
        },
        {
          "value": "SA",
          "label": "SA"
        },
        {
          "value": "TAS",
          "label": "TAS"
        },
        {
          "value": "VIC",
          "label": "VIC"
        },
        {
          "value": "WA",
          "label": "WA"
        }
      ]
    },
    {
      "target": "postalCode",
      "label": "Postal / ZIP code",
      "required": true,
      "width": 4
    }
  ]
};

export const COMMON_TEMPLATE_ID = COUNTRY_TEMPLATE_MAP.COMMON;

// Countries offered in the country dropdown (everything in the map except COMMON).
export const ADDRESS_COUNTRIES: string[] = Object.keys(COUNTRY_TEMPLATE_MAP).filter((c) => c !== "COMMON").sort();

/** Sub-fields to render for a given country code (falls back to COMMON). */
export function addressSubFields(country?: string): AddressSubField[] {
  const id = (country && COUNTRY_TEMPLATE_MAP[country]) || COMMON_TEMPLATE_ID;
  return ADDRESS_TEMPLATES[id] ?? ADDRESS_TEMPLATES[COMMON_TEMPLATE_ID] ?? [];
}
