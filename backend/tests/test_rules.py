import pytest

from app.services.calculations import calculate
from app.services.hl7 import HL7Error, build_ack, parse_oru
from app.services.westgard import evaluate


class TestWestgard:
    def test_in_control(self):
        assert evaluate(0.5, [0.2, -0.3]) == ("accepted", [])

    def test_1_2s_is_a_warning(self):
        assert evaluate(2.3, [0.1, -0.4]) == ("warning", ["1-2s"])

    def test_1_3s(self):
        status, rules = evaluate(-3.2, [])
        assert status == "rejected" and "1-3s" in rules

    def test_2_2s(self):
        assert evaluate(2.2, [2.5, 0.1]) == ("rejected", ["2-2s"])

    def test_r_4s(self):
        assert evaluate(2.1, [-2.1]) == ("rejected", ["R-4s"])

    def test_4_1s(self):
        assert evaluate(1.2, [1.4, 1.1, 1.3]) == ("rejected", ["4-1s"])

    def test_10x(self):
        assert evaluate(0.3, [0.2, 0.5, 0.1, 0.4, 0.6, 0.3, 0.2, 0.1, 0.4]) == ("rejected", ["10x"])


class TestCalculations:
    def test_anion_gap(self):
        assert calculate("anion_gap", {"NA": 140, "CL": 104, "CO2": 24}, "M", 40) == 12

    def test_egfr_ckd_epi_2021(self):
        # Reference values from the published CKD-EPI 2021 equation.
        assert calculate("egfr", {"CREA": 1.0}, "F", 50) == pytest.approx(68.6, abs=0.1)
        assert calculate("egfr", {"CREA": 1.2}, "M", 60) == pytest.approx(69.2, abs=0.1)

    def test_egfr_needs_adult_with_known_sex(self):
        assert calculate("egfr", {"CREA": 0.5}, "M", 10) is None
        assert calculate("egfr", {"CREA": 1.0}, "U", 40) is None

    def test_ldl_sampson(self):
        ldl = calculate("ldl_sampson", {"CHOL": 200, "HDL": 50, "TRIG": 150}, "M", 50)
        assert 118 < ldl < 124

    def test_ldl_not_valid_with_very_high_triglycerides(self):
        assert calculate("ldl_sampson", {"CHOL": 300, "HDL": 30, "TRIG": 900}, "M", 50) is None

    def test_missing_inputs(self):
        assert calculate("anion_gap", {"NA": 140}, "M", 40) is None

    def test_absolute_neutrophils(self):
        assert calculate("anc", {"WBC": 8.0, "NEUT": 60}, "F", 30) == pytest.approx(4.8)


class TestHL7:
    MESSAGE = "\r".join(
        [
            "MSH|^~\\&|COBAS|LAB|LIS|LAB|20261005101500||ORU^R01|MSG0001|P|2.5.1",
            "PID|1||MRN0000001",
            "OBR|1||2610050001",
            "OBX|1|NM|NA^Sodium||141|mmol/L",
            "OBX|2|NM|K^Potassium||4.2|mmol/L",
        ]
    )

    def test_parse(self):
        msg = parse_oru(self.MESSAGE)
        assert msg.control_id == "MSG0001"
        assert msg.sending_application == "COBAS"
        assert [(o.accession, o.test_code, o.value) for o in msg.observations] == [
            ("2610050001", "NA", "141"),
            ("2610050001", "K", "4.2"),
        ]

    def test_rejects_other_message_types(self):
        with pytest.raises(HL7Error):
            parse_oru("MSH|^~\\&|X|Y|LIS|LAB|20261005||ADT^A01|1|P|2.5.1")

    def test_ack(self):
        ack = build_ack(parse_oru(self.MESSAGE), "AA", "ok")
        assert ack.split("\r")[1] == "MSA|AA|MSG0001|ok"
