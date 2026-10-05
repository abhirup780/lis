from datetime import date

from tests.conftest import Api


def make_patient(api: Api, sex="M", dob="1970-05-01", **kw) -> dict:
    r = api.post(
        "/patients", json={"first_name": "Test", "last_name": "Patient", "date_of_birth": dob, "sex": sex, **kw}
    )
    assert r.status_code == 201, r.text
    return r.json()


def make_order(api: Api, patient_id: int, panels=(), tests=(), priority="routine") -> dict:
    r = api.post(
        "/orders",
        json={
            "patient_id": patient_id,
            "ordering_provider": "Dr. Test",
            "priority": priority,
            "panel_codes": list(panels),
            "test_codes": list(tests),
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def receive_all(api: Api, order: dict) -> None:
    for s in order["specimens"]:
        r = api.post(f"/specimens/{s['id']}/action", json={"action": "receive"})
        assert r.status_code == 200, r.text


def result_ids(order: dict) -> dict[str, int]:
    return {t["test"]["code"]: t["id"] for t in order["tests"]}


def enter(api: Api, order: dict, values: dict[str, str], **extra) -> dict:
    ids = result_ids(order)
    r = api.post(
        "/results", json={"results": [{"order_test_id": ids[c], "value": v, **extra} for c, v in values.items()]}
    )
    assert r.status_code == 200, r.text
    return r.json()


def fetch(api: Api, order: dict) -> dict:
    return api.get(f"/orders/{order['id']}").json()


def by_code(order: dict) -> dict[str, dict]:
    return {t["test"]["code"]: t for t in order["tests"]}


def test_login_rejects_bad_password(client):
    r = client.post("/api/auth/login", data={"username": "tech", "password": "wrong"})
    assert r.status_code == 401


def test_requires_auth(client):
    assert client.get("/api/patients").status_code == 401


def test_patient_mrn_generated_and_searchable(frontdesk):
    p = make_patient(frontdesk, first_name="Ada", last_name="Lovelace")
    assert p["mrn"].startswith("MRN")
    r = frontdesk.get("/patients", params={"q": "lovel"})
    assert r.json()["total"] == 1


def test_future_birth_date_rejected(frontdesk):
    r = frontdesk.post(
        "/patients", json={"first_name": "A", "last_name": "B", "date_of_birth": "2999-01-01", "sex": "F"}
    )
    assert r.status_code == 422


def test_order_splits_specimens_by_tube(frontdesk):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], panels=["CMP", "CBCD"], tests=["HBA1C"])
    types = sorted((s["specimen_type"]["code"]) for s in order["specimens"])
    # Serum for chemistry, plus one EDTA tube each for hematology and chemistry (HbA1c).
    assert types == ["EDTA", "EDTA", "SST"]
    assert all(len(s["accession"]) == 10 for s in order["specimens"])
    codes = {t["test"]["code"] for t in order["tests"]}
    assert {"NA", "AGAP", "EGFR", "WBC", "ANC", "HBA1C"} <= codes


def test_duplicate_tests_across_panels_ordered_once(frontdesk):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], panels=["BMP", "CMP"])
    codes = [t["test"]["code"] for t in order["tests"]]
    assert len(codes) == len(set(codes))


def test_cannot_result_before_receipt(frontdesk, tech):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], tests=["NA"])
    body = enter(tech, order, {"NA": "140"})
    assert body["errors"] and "not been received" in body["errors"][0]["error"]


def test_front_desk_cannot_enter_results(frontdesk):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], tests=["NA"])
    r = frontdesk.post("/results", json={"results": [{"order_test_id": order["tests"][0]["id"], "value": "140"}]})
    assert r.status_code == 403


def test_full_chemistry_workflow_with_calculations_and_flags(frontdesk, tech):
    p = make_patient(frontdesk, sex="F", dob="1976-01-01")
    order = make_order(frontdesk, p["id"], panels=["BMP"])
    receive_all(frontdesk, order)
    enter(tech, order, {"NA": "140", "K": "5.6", "CL": "104", "CO2": "24", "BUN": "14", "CREA": "1.00", "GLU": "92", "CA": "9.4"})
    order = fetch(tech, order)
    r = by_code(order)
    assert r["NA"]["flag"] == "N" and r["NA"]["ref_text"] == "136 - 145"
    assert r["K"]["flag"] == "H"
    assert r["AGAP"]["value_text"] == "12" and r["AGAP"]["source"] == "calculated"
    assert r["BUNCR"]["value_text"] == "14"
    assert r["EGFR"]["value_numeric"] is not None
    assert r["CREA"]["ref_text"] == "0.59 - 1.04"  # female adult range
    assert order["status"] == "in_progress"

    # Manually entered results wait for a technologist to verify them.
    measured = [t["id"] for t in order["tests"] if not t["test"]["is_calculated"]]
    v = tech.post("/results/verify", json={"order_test_ids": measured})
    assert v.status_code == 200 and not v.json()["errors"]
    order = fetch(tech, order)
    # Calculated results follow their inputs to verified, and the order completes.
    assert all(t["status"] == "verified" for t in order["tests"])
    assert order["status"] == "completed"


def test_invalid_numeric_value(frontdesk, tech):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], tests=["NA"])
    receive_all(frontdesk, order)
    body = enter(tech, order, {"NA": "abc"})
    assert "not a number" in body["errors"][0]["error"]


def test_qualified_values_are_kept(frontdesk, tech):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], tests=["TBIL"])
    receive_all(frontdesk, order)
    enter(tech, order, {"TBIL": "<0.1"})
    assert by_code(fetch(tech, order))["TBIL"]["value_text"] == "<0.1"


def test_critical_result_requires_documented_callback(frontdesk, tech):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], tests=["K"], priority="stat")
    receive_all(frontdesk, order)
    enter(tech, order, {"K": "7.1"})
    k = by_code(fetch(tech, order))["K"]
    assert k["flag"] == "HH" and k["is_critical"]
    tech.post("/results/verify", json={"order_test_ids": [k["id"]]})

    pending = tech.get("/criticals", params={"status": "pending"}).json()
    assert len(pending) == 1 and pending[0]["result"]["value_text"] == "7.1"
    assert tech.get("/dashboard").json()["critical_pending"] == 1

    no_readback = tech.post(f"/criticals/{pending[0]['id']}/acknowledge", json={"notified_person": "RN Smith", "read_back": False})
    assert no_readback.status_code == 400
    ok = tech.post(f"/criticals/{pending[0]['id']}/acknowledge", json={"notified_person": "RN Smith", "read_back": True})
    assert ok.status_code == 200 and ok.json()["status"] == "notified"
    assert tech.get("/criticals", params={"status": "pending"}).json() == []


def test_instrument_results_autoverify_when_normal(frontdesk, tech):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], panels=["LYTES"])
    receive_all(frontdesk, order)
    accession = order["specimens"][0]["accession"]
    r = tech.post(
        "/instruments/results",
        json={
            "instrument": "Cobas c503",
            "results": [
                {"accession": accession, "test_code": "NA", "value": "140"},
                {"accession": accession, "test_code": "K", "value": "5.8"},  # high: needs review
                {"accession": accession, "test_code": "CL", "value": "103"},
                {"accession": accession, "test_code": "CO2", "value": "25"},
                {"accession": accession, "test_code": "GLU", "value": "90"},  # not ordered
            ],
        },
    )
    body = r.json()
    assert body["autoverified"] == 3 and body["accepted"] == 1 and body["errors"] == 1
    results = by_code(fetch(tech, order))
    assert results["NA"]["auto_verified"] and results["NA"]["instrument"] == "Cobas c503"
    assert results["K"]["status"] == "resulted"
    # The anion gap only depends on NA, CL and CO2, so it is verified with them.
    assert results["AGAP"]["status"] == "verified"


def test_hl7_interface(frontdesk, tech):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], tests=["NA", "K"])
    receive_all(frontdesk, order)
    accession = order["specimens"][0]["accession"]
    message = "\r".join(
        [
            "MSH|^~\\&|COBAS|LAB|LIS|LAB|20261005101500||ORU^R01|M42|P|2.5.1",
            f"OBR|1||{accession}",
            "OBX|1|NM|NA^Sodium||141|mmol/L",
            "OBX|2|NM|K^Potassium||4.3|mmol/L",
        ]
    )
    r = tech.client.post(
        "/api/instruments/hl7", content=message, headers={**tech.headers, "Content-Type": "text/plain"}
    )
    assert r.status_code == 200
    assert "MSA|AA|M42" in r.text
    assert fetch(tech, order)["status"] == "completed"


def test_delta_check_against_previous_result(frontdesk, tech):
    p = make_patient(frontdesk)
    first = make_order(frontdesk, p["id"], tests=["HGB"])
    receive_all(frontdesk, first)
    enter(tech, first, {"HGB": "14.0"})
    tech.post("/results/verify", json={"order_test_ids": [first["tests"][0]["id"]]})

    second = make_order(frontdesk, p["id"], tests=["HGB"])
    receive_all(frontdesk, second)
    enter(tech, second, {"HGB": "10.0"})  # 29% drop, above the 20% delta limit
    hgb = by_code(fetch(tech, second))["HGB"]
    assert hgb["delta_failed"] and hgb["previous_value"] == 14.0

    trend = tech.get(f"/patients/{p['id']}/trend/HGB").json()
    assert [t["value_numeric"] for t in trend] == [14.0]


def test_delta_failure_blocks_autoverification(frontdesk, tech):
    p = make_patient(frontdesk)
    first = make_order(frontdesk, p["id"], tests=["NA"])
    receive_all(frontdesk, first)
    tech.post("/instruments/results", json={"instrument": "X", "results": [{"accession": first["specimens"][0]["accession"], "test_code": "NA", "value": "137"}]})
    second = make_order(frontdesk, p["id"], tests=["NA"])
    receive_all(frontdesk, second)
    r = tech.post("/instruments/results", json={"instrument": "X", "results": [{"accession": second["specimens"][0]["accession"], "test_code": "NA", "value": "144.9"}]})
    assert r.json()["accepted"] == 1  # 5.8% change: normal but held for review


def test_amending_verified_result_keeps_history(frontdesk, tech):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], tests=["GLU"])
    receive_all(frontdesk, order)
    enter(tech, order, {"GLU": "95"})
    ot_id = order["tests"][0]["id"]
    tech.post("/results/verify", json={"order_test_ids": [ot_id]})

    no_reason = enter(tech, order, {"GLU": "59"})
    assert "reason" in no_reason["errors"][0]["error"]

    enter(tech, order, {"GLU": "59"}, amend_reason="Transcription error")
    glu = by_code(fetch(tech, order))["GLU"]
    assert glu["is_amended"] and glu["status"] == "resulted" and glu["flag"] == "L"
    history = tech.get(f"/orders/{order['id']}/tests/{ot_id}/history").json()
    assert history[0]["value_text"] == "95" and history[0]["reason"] == "Transcription error"


def test_rejected_specimen_gets_a_replacement(frontdesk):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], panels=["CBC"])
    s = order["specimens"][0]
    assert frontdesk.post(f"/specimens/{s['id']}/action", json={"action": "reject"}).status_code == 400
    r = frontdesk.post(f"/specimens/{s['id']}/action", json={"action": "reject", "reason": "Clotted"})
    assert r.json()["status"] == "rejected"
    order = fetch(frontdesk, order)
    statuses = sorted(sp["status"] for sp in order["specimens"])
    assert statuses == ["pending", "rejected"]
    new = next(sp for sp in order["specimens"] if sp["status"] == "pending")
    assert all(t["specimen_id"] == new["id"] for t in order["tests"])


def test_pediatric_reference_ranges(frontdesk, tech):
    newborn = make_patient(frontdesk, dob=date.today().isoformat())
    order = make_order(frontdesk, newborn["id"], tests=["WBC"])
    receive_all(frontdesk, order)
    enter(tech, order, {"WBC": "20.00"})
    wbc = by_code(fetch(tech, order))["WBC"]
    assert wbc["flag"] == "N" and wbc["ref_text"] == "9.00 - 30.00"


def test_qc_rejection_blocks_autoverification(frontdesk, tech, manager):
    r = manager.post(
        "/qc/materials",
        json={"name": "Chem control", "lot_number": "L1", "level": 1, "department_code": "CHEM", "targets": [{"test_code": "NA", "mean": 140, "sd": 2}]},
    )
    target_id = r.json()["targets"][0]["id"]
    qc = tech.post("/qc/results", json={"target_id": target_id, "value": 147.5})  # z = 3.75
    assert qc.json()["status"] == "rejected" and "1-3s" in qc.json()["violations"]

    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], tests=["NA"])
    receive_all(frontdesk, order)
    accession = order["specimens"][0]["accession"]
    up = tech.post("/instruments/results", json={"instrument": "X", "results": [{"accession": accession, "test_code": "NA", "value": "140"}]})
    assert up.json()["accepted"] == 1 and up.json()["autoverified"] == 0

    # A passing QC run releases autoverification again.
    tech.post("/qc/results", json={"target_id": target_id, "value": 140.2})
    status = tech.get("/qc/status").json()
    assert status[0]["last_status"] == "accepted"


def test_catalog_update_requires_manager(tech, manager):
    assert tech.patch("/catalog/tests/NA", json={"autoverify": False}).status_code == 403
    r = manager.patch(
        "/catalog/tests/NA",
        json={"reference_ranges": [{"low": 135, "high": 145, "critical_low": 120, "critical_high": 160}]},
    )
    assert r.status_code == 200
    assert r.json()["reference_ranges"][0]["low"] == 135
    audit = manager.get("/audit", params={"action": "test."}).json()
    assert audit["total"] == 1


def test_admin_manages_users(admin, tech):
    r = admin.post("/users", json={"username": "newtech", "full_name": "New Tech", "role": "technologist", "password": "Password1!"})
    assert r.status_code == 201
    assert tech.get("/users").status_code == 403


def test_dashboard(frontdesk, tech):
    p = make_patient(frontdesk)
    make_order(frontdesk, p["id"], panels=["CBC"], priority="stat")
    d = tech.get("/dashboard").json()
    assert d["orders_today"] == 1 and d["stat_open"] == 1 and d["awaiting_collection"] == 1


def test_worklist(frontdesk, tech):
    p = make_patient(frontdesk)
    order = make_order(frontdesk, p["id"], panels=["BMP", "CBC"])
    receive_all(frontdesk, order)
    heme = tech.get("/worklist", params={"department": "HEME"}).json()
    assert len(heme) == 1 and {r["test"]["code"] for r in heme[0]["results"]} >= {"WBC", "PLT"}
    assert tech.get("/worklist", params={"status": "review"}).json() == []


def test_calculation_not_applicable_does_not_block_completion(frontdesk, tech):
    child = make_patient(frontdesk, dob="2018-03-01")
    order = make_order(frontdesk, child["id"], panels=["BMP"])
    receive_all(frontdesk, order)
    enter(tech, order, {"NA": "139", "K": "4.2", "CL": "103", "CO2": "24", "BUN": "12", "CREA": "0.45", "GLU": "88", "CA": "9.6"})
    egfr = by_code(fetch(tech, order))["EGFR"]
    assert egfr["status"] == "cancelled" and "Not calculated" in egfr["comment"]
    measured = [t["id"] for t in order["tests"] if not t["test"]["is_calculated"]]
    tech.post("/results/verify", json={"order_test_ids": measured})
    assert fetch(tech, order)["status"] == "completed"
