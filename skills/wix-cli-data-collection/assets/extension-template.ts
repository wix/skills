/**
 * Template for src/data/extensions.ts
 * 
 * This file defines all CMS collections for your Wix CLI app.
 * All collections are defined in a single file using extensions.genericExtension().
 * 
 * Replace the example collection with your actual collections.
 */

import { extensions } from '@wix/astro/builders';

export const dataExtension = extensions.genericExtension({
  // IMPORTANT: Replace with a freshly generated UUID v4 string
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // Do NOT use randomUUID() - the UUID must be a static string
  compId: '{{GENERATE_UUID}}',
  
  // Always 'data-extension' for CMS collections
  compName: 'data-extension',
  
  // Always 'DATA_COMPONENT' for CMS collections
  compType: 'DATA_COMPONENT',
  
  compData: {
    dataComponent: {
      // Array of all collections
      collections: [
        {
          // Legacy field - will be removed in future
          schemaUrl: 'https://www.wix.com/',
          
          // Collection identifier (lower-kebab-case or lower_underscore)
          // This will be scoped with app namespace automatically
          idSuffix: 'example-collection',
          
          // Human-readable name shown in CMS
          displayName: 'Example Collection',
          
          // Field used for display (optional)
          displayField: 'title',
          
          // Array of field definitions
          fields: [
            {
              // Field identifier (lowerCamelCase, ASCII only)
              key: 'title',
              
              // Human-readable label
              displayName: 'Title',
              
              // Field type - see SKILL.md Field Types section for all types
              type: 'TEXT',
              
              // Optional: Help text
              description: 'The title of the item'
            },
            {
              key: 'amount',
              displayName: 'Amount',
              type: 'NUMBER'
            },
            {
              key: 'isActive',
              displayName: 'Is Active',
              type: 'BOOLEAN'
            }
            // Add more fields as needed
          ],
          
          // Permission configuration
          // See SKILL.md Permissions section for all access levels
          dataPermissions: {
            // Who can read items
            itemRead: 'ANYONE',
            
            // Who can create items
            itemInsert: 'PRIVILEGED',
            
            // Who can update items
            itemUpdate: 'PRIVILEGED',
            
            // Who can delete items
            itemRemove: 'PRIVILEGED'
          },
          
          // Optional: Initial seed data
          // Only include if blueprint mentions example data
          initialData: [
            {
              // Must match field keys exactly (lowerCamelCase)
              title: 'Example Item 1',
              amount: 10,
              isActive: true
            },
            {
              title: 'Example Item 2',
              amount: 20,
              isActive: false
            }
            // Add more initial items as needed
          ]
        }
        // Add more collections as needed
      ]
    }
  }
});
