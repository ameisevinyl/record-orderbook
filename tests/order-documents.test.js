import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderSummaryText, buildTracklistText } from "../src/lib/order-documents.js";

const date = new Date(2026, 8, 23);
const config = {
  formats: [{
    id:"7", centerHole:{normal:7.4, big:38},
    printableParts:{
      outerCover:{products:[
        {id:"cover-printed", name:"printed", kind:"printed"},
        {id:"cover-brown", name:"brown, closed", kind:"unprinted"}
      ]},
      innerSleeve:{products:[
        {id:"sleeve-printed", name:"printed", kind:"printed"},
        {id:"sleeve-white", name:"white, center cut-out", kind:"unprinted"}
      ]},
      inlay:{products:[{id:"inlay-printed", name:"printed", kind:"printed"}]}
    }
  }]
};

function side(overrides = {}){
  return {
    blank:false, rpm:"45", matrixInscription:"TEST A", continuous:false,
    continuousLength:"", continuousFileName:null, tracks:[], ...overrides
  };
}

function project(overrides = {}){
  return {
    catalogue:"TEST001", format:"7", soundsystem:false,
    albumTitle:"Test Release", albumArtist:"Test Artist", notes:"",
    sides:{A:side(), B:side({blank:true, matrixInscription:"TEST B"})},
    labels:{bigCenter:false, sides:{A:{whitelabel:true}, B:{whitelabel:true}}},
    coverSleeve:{
      cover:{productId:null}, innerSleeve:{productId:"sleeve-white"},
      inlay:{productId:null, front:{}, back:{}}
    },
    vinylColor:[], shippingBilling:{billing:{}, shipping:[]}, ...overrides
  };
}

test("both documents identify a soundsystem cut; summary includes big center, whitelabels, and a blank side", () => {
  const p = project({soundsystem:true, labels:{
    bigCenter:true, sides:{A:{whitelabel:true}, B:{whitelabel:true}}
  }});
  const summary = buildOrderSummaryText(p, config, date);
  const tracklist = buildTracklistText(p, config, date);

  for(const text of [summary, tracklist]){
    assert.match(text, /TEST001 - Test Release - Test Artist - 2026-09-23/);
    assert.match(text, /Format: 7"\nCut: soundsystem/);
    assert.match(text, /SIDE B — blank/);
  }
  assert.match(summary, /Center hole: big \(38mm\)/);
  assert.match(summary, /Label A: whitelabel\n  Label B: whitelabel/);
  assert.doesNotMatch(tracklist, /PACKAGING:|BILLING ADDRESS:|SHIPPING:|Files:/);
});

test("summary describes printed labels with canonical and original names and lists their files", () => {
  const p = project({labels:{bigCenter:false, sides:{
    A:{whitelabel:false, fileName:"TEST001_labels_A_v1.pdf", originalFileName:"label a final.pdf"},
    B:{whitelabel:false, fileName:"TEST001_labels_B_v1.pdf", originalFileName:"TEST001_labels_B_v1.pdf"}
  }}});
  const summary = buildOrderSummaryText(p, config, date);

  assert.match(summary, /Center hole: standard \(7\.4mm\)/);
  assert.match(summary, /Label A: printed — TEST001_labels_A_v1\.pdf \(was: label a final\.pdf\)/);
  assert.match(summary, /Label B: printed — TEST001_labels_B_v1\.pdf\n/);
  assert.match(summary, /Files:\n  TEST001_labels_A_v1\.pdf\n  TEST001_labels_B_v1\.pdf\n/);
});

test("continuous side file is authoritative and saved rows form a cue list without inactive filenames", () => {
  const p = project({sides:{
    A:side({
      continuous:true, continuousLength:"7:05", continuousFileName:"TEST001_A_side_v1.wav",
      tracks:[
        {title:"Opening", artist:"Test Artist", length:"3:00", gap:"2", fileName:"inactive-a1.wav"},
        {title:"Finale", artist:"Guest", length:"4:03", gap:"2", fileName:"inactive-a2.wav"}
      ]
    }),
    B:side({blank:true})
  }});

  for(const text of [buildOrderSummaryText(p, config, date), buildTracklistText(p, config, date)]){
    assert.match(text, /SIDE A — 45 RPM — total 7:05/);
    assert.match(text, /continuous file \(authoritative\): TEST001_A_side_v1\.wav/);
    assert.match(text, /saved cue\/sequence list:/);
    assert.match(text, /│ A2   │ 0:02   │ 3:02  │ 4:03   │ Finale  │ Guest/);
    assert.doesNotMatch(text, /inactive-a[12]\.wav|filename/);
  }
});

test("summary includes packaging manifest and complete billing/shipping details", () => {
  const p = project({
    coverSleeve:{
      cover:{productId:"cover-printed", fileName:"TEST001_cover_v1.pdf", originalFileName:"cover final.pdf"},
      innerSleeve:{productId:"sleeve-white"},
      inlay:{
        productId:"inlay-printed",
        front:{fileName:"TEST001_inlay_front_v1.pdf", originalFileName:"front.pdf"},
        back:{fileName:"TEST001_inlay_back_v1.pdf", originalFileName:"back.pdf"}
      }
    },
    vinylColor:[{color:"black", qty:"300"}, {color:"random", qty:"50"}],
    shippingBilling:{
      billing:{
        recipientName:"Label GmbH", attention:"Accounts", addressLine1:"Main St 1",
        addressLine2:"Floor 2", city:"Berlin", postalCode:"10115", countryCode:"DE",
        email:"billing@example.com", phone:"+49 30 123", vat:"DE123", eori:"DE456"
      },
      shipping:[{
        qtyByColor:{black:"300", random:"50"}, recipientName:"Warehouse", attention:"Goods in",
        addressLine1:"Dock Rd 2", city:"Hamburg", stateProvince:"HH", postalCode:"20095",
        countryCode:"DE", isResidential:true, email:"ship@example.com", phone:"+49 40 123",
        vat:"DE789", eori:"DE012", note:"Call first"
      }]
    }
  });
  const summary = buildOrderSummaryText(p, config, date);

  assert.match(summary, /Files:\n  TEST001_cover_v1\.pdf\n  TEST001_inlay_front_v1\.pdf\n  TEST001_inlay_back_v1\.pdf/);
  assert.match(summary, /Cover: printed — TEST001_cover_v1\.pdf \(was: cover final\.pdf\)/);
  assert.match(summary, /Inner sleeve: white, center cut-out/);
  assert.match(summary, /Inlay: front — TEST001_inlay_front_v1\.pdf \(was: front\.pdf\)\n         back  — TEST001_inlay_back_v1\.pdf \(was: back\.pdf\)/);
  assert.match(summary, /BILLING ADDRESS:\n  Label GmbH — Accounts\n  Main St 1\n  Floor 2/);
  assert.match(summary, /SHIPPING \(pressed: 300 Black, 50 Random colour\):/);
  assert.match(summary, /\[1\] 300 black, 50 random — Warehouse \/ Goods in/);
  assert.match(summary, /20095 Hamburg, HH, DE \(residential\)/);
  assert.match(summary, /note: Call first/);
});

test("normal cut and blank optional values render without throwing", () => {
  const p = project({
    catalogue:"", albumTitle:"", albumArtist:"", notes:undefined,
    sides:{A:side({rpm:"", matrixInscription:"", tracks:[{}]}), B:side({blank:true})},
    labels:{bigCenter:false, sides:{}}, coverSleeve:{}, vinylColor:undefined,
    shippingBilling:{billing:{}, shipping:[{}]}
  });
  const summary = buildOrderSummaryText(p, config, date);
  const tracklist = buildTracklistText(p, config, date);

  assert.match(summary, /\(no catalogue number\) - \(no title\) - \(no artist\) - 2026-09-23/);
  assert.match(summary, /Cut: normal/);
  assert.match(summary, /Label A: printed — \(no file\)/);
  assert.match(summary, /\[1\] no qty —/);
  assert.match(tracklist, /Cut: normal/);
  assert.match(tracklist, /\(no file — manual entry\)/);
});

test("summary marks invalid quantities instead of treating them as production totals", () => {
  const p = project({
    vinylColor:[{color:"black", qty:"1.5"}],
    shippingBilling:{billing:{}, shipping:[{qtyByColor:{black:"1e2"}}]}
  });
  const summary = buildOrderSummaryText(p, config, date);
  assert.match(summary, /pressed: INVALID qty "1\.5" Black/);
  assert.match(summary, /INVALID qty "1e2" black/);
});
