// Author: Preston Lee

import { Injectable } from '@angular/core';
import { CqlTestResults } from '../models/cql-test-results.model';
import { ExamplePaths } from '../constants/example-paths.constants';

@Injectable({
  providedIn: 'root'
})
export class FileLoaderService {

  async loadFromFile(file: File): Promise<CqlTestResults> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const data = JSON.parse(content);
          resolve(data as CqlTestResults);
        } catch (error) {
          reject(new Error('Invalid JSON file: ' + (error as Error).message));
        }
      };
      
      reader.onerror = () => {
        reject(new Error('Error reading file'));
      };
      
      reader.readAsText(file);
    });
  }

  async loadFromUrl(url: string): Promise<CqlTestResults> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data as CqlTestResults;
    } catch (error) {
      throw new Error('Error loading file from URL: ' + (error as Error).message);
    }
  }

  async loadFromExample(): Promise<CqlTestResults> {
    try {
      const response = await fetch(ExamplePaths.RESULTS_JSON);
      if (!response.ok) {
        throw new Error(`Failed to load example file: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data as CqlTestResults;
    } catch (error) {
      throw new Error('Error loading example file: ' + (error as Error).message);
    }
  }
}
