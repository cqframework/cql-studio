// Author: Eugene Vestel
// CMS125: Breast Cancer Screening — demo CQL used by CQL Studio's SQL-on-FHIR pipeline.
//
// This is a simplified, demo-grade encoding of CMS125 for end-to-end pipeline verification.
// Real CMS125 production logic is in eCQI: https://ecqi.healthit.gov/ecqm/ec/2024/cms125v12

library BreastCancerScreening version '11.1.000'

using FHIR version '4.0.1'

include FHIRHelpers version '4.0.1'

valueset "Mammography": 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018'
valueset "Bilateral Mastectomy": 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.198.12.1005'
valueset "Office Visit": 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.101.12.1001'

parameter "Measurement Period" Interval<DateTime>

context Patient

define "Qualifying Encounters":
  [Encounter: "Office Visit"] E
    where E.period during "Measurement Period"

define "Initial Population":
  Patient.gender = 'female'
    and AgeInYearsAt(start of "Measurement Period") >= 51
    and AgeInYearsAt(start of "Measurement Period") <= 74
    and exists "Qualifying Encounters"

define "Denominator":
  "Initial Population"

define "Denominator Exclusion":
  exists [Procedure: "Bilateral Mastectomy"]

define "Numerator":
  exists ([Observation: "Mammography"] O
    where O.effective during "Measurement Period")
