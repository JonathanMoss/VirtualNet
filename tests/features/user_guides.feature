Feature: VirtualNet User Documentation Guides

  As a VirtualNet user (student or instructor),
  I want to access dedicated, modular documentation guides,
  So that I can learn how to operate the radio simulator, perform voice procedure, and manage net sessions.

  Scenario: A student accesses the Student User Guide
    When a user requests the Student User Guide at "/guide/student"
    Then the response status code should be 200
    And the page title should contain "Student User Guide"
    And the page content should include "Push-to-Talk" and "OVER"

  Scenario: An instructor accesses the Sunray User Guide
    When a user requests the Sunray User Guide at "/guide/sunray"
    Then the response status code should be 200
    And the page title should contain "Sunray User Guide"
    And the page content should include "Sunray Portal Guide" and "Break-In"

  Scenario: A user requests an invalid or non-existent guide
    When a user requests a guide at "/guide/unknown_guide_slug"
    Then the response status code should be 404
    And the page content should display "404 - Guide Not Found"
